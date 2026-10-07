import assert from "node:assert/strict";
import test from "node:test";
import { GoogleSearchConsoleClient } from "./google-search-console.client";
import {
  GSC_CANONICAL_SITE_URL,
  GSC_MAX_RETRIES,
  GSC_TOKEN_URL,
} from "./google-search-console.constants";
import { GoogleSearchConsoleApiError } from "./google-search-console.errors";
import { reportDefinition } from "./google-search-console.reports";

function client(fetchImpl: typeof fetch, extra?: { reportRowLimit?: number; maxPages?: number }) {
  return new GoogleSearchConsoleClient({
    clientId: "client-id",
    clientSecret: "super-secret",
    refreshToken: "refresh-secret",
    siteUrl: GSC_CANONICAL_SITE_URL,
    fetchImpl,
    reportRowLimit: extra?.reportRowLimit ?? 2,
    maxPages: extra?.maxPages ?? 5,
    retryBackoffMs: 0,
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenThen(handler: (url: string, init?: RequestInit) => Response) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === GSC_TOKEN_URL) {
      const body = String(init?.body ?? "");
      assert.ok(body.includes("grant_type=refresh_token"));
      return json(200, { access_token: "access-secret", expires_in: 3600 });
    }
    return handler(url, init);
  }) as typeof fetch;
}

function row(keys: string[], clicks = 1) {
  return {
    keys,
    clicks,
    impressions: 10,
    ctr: 0.1,
    position: 4.2,
  };
}

test("rejects a non-canonical site URL", () => {
  assert.throws(
    () =>
      new GoogleSearchConsoleClient({
        clientId: "id",
        clientSecret: "secret",
        refreshToken: "refresh",
        siteUrl: "https://udderlyridiculousfarmlife.com/",
      }),
    /gsc_site_url_not_canonical/,
  );
});

test("GET site is read-only and encodes the domain property", async () => {
  const fetchImpl = tokenThen((url, init) => {
    assert.equal(init?.method, "GET");
    assert.ok(url.includes("/sites/sc-domain%3Audderlyridiculousfarmlife.com"));
    assert.ok(!url.includes(":create"));
    return json(200, {
      siteUrl: GSC_CANONICAL_SITE_URL,
      permissionLevel: "siteOwner",
    });
  });
  const payload = await client(fetchImpl).getSite();
  assert.equal(payload.permissionLevel, "siteOwner");
});

test("never includes secrets in API error messages", async () => {
  const fetchImpl = tokenThen(() =>
    json(400, { error: { message: "bad super-secret refresh-secret access-secret" } }),
  );
  await assert.rejects(
    () => client(fetchImpl).getSite(),
    (error: unknown) => {
      assert.ok(error instanceof GoogleSearchConsoleApiError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.retryable, false);
      assert.ok(!error.message.includes("super-secret"));
      assert.ok(!error.message.includes("refresh-secret"));
      assert.ok(!error.message.includes("access-secret"));
      return true;
    },
  );
});

test("4xx responses fail without retry", async () => {
  let calls = 0;
  const fetchImpl = tokenThen(() => {
    calls += 1;
    return json(403, { error: { message: "forbidden" } });
  });
  await assert.rejects(() => client(fetchImpl).getSite(), /HTTP 403/);
  assert.equal(calls, 1);
});

test("retries bounded 429 then fails", async () => {
  let calls = 0;
  const fetchImpl = tokenThen(() => {
    calls += 1;
    return json(429, { error: { message: "quota" } });
  });
  await assert.rejects(() => client(fetchImpl).getSite(), /HTTP 429/);
  assert.equal(calls, GSC_MAX_RETRIES);
});

test("retries 503 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = tokenThen(() => {
    calls += 1;
    if (calls === 1) {
      return json(503, {});
    }
    return json(200, { siteUrl: GSC_CANONICAL_SITE_URL });
  });
  const payload = await client(fetchImpl).getSite();
  assert.equal(payload.siteUrl, GSC_CANONICAL_SITE_URL);
  assert.equal(calls, 2);
});

test("empty Search Analytics results are a complete report", async () => {
  const fetchImpl = tokenThen((_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      dataState?: string;
      searchType?: string;
      startRow?: number;
    };
    assert.equal(body.dataState, "final");
    assert.equal(body.searchType, "web");
    assert.equal(body.startRow, 0);
    return json(200, {});
  });
  const report = await client(fetchImpl).runSearchAnalyticsPaginated({
    family: "daily_totals",
    dimensions: ["date"],
    startDate: "2026-09-30",
    endDate: "2026-09-30",
  });
  assert.equal(report.rowCount, 0);
  assert.equal(report.rows.length, 0);
  assert.equal(report.requestCount, 1);
  assert.equal(report.dataState, "final");
});

test("paginates with startRow until a short page", async () => {
  const fetchImpl = tokenThen((_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { startRow?: number };
    if (body.startRow === 0) {
      return json(200, {
        rows: [row(["2026-09-30"]), row(["2026-10-01"])],
      });
    }
    assert.equal(body.startRow, 2);
    return json(200, { rows: [row(["2026-10-02"])] });
  });
  const report = await client(fetchImpl).runSearchAnalyticsPaginated({
    family: "daily_totals",
    dimensions: ["date"],
    startDate: "2026-09-30",
    endDate: "2026-10-02",
  });
  assert.equal(report.requestCount, 2);
  assert.equal(report.rows.length, 3);
});

test("continues after an exact page-size boundary", async () => {
  const fetchImpl = tokenThen((_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { startRow?: number };
    if ((body.startRow ?? 0) === 0) {
      return json(200, {
        rows: [row(["2026-09-30"]), row(["2026-10-01"])],
      });
    }
    return json(200, { rows: [] });
  });
  const report = await client(fetchImpl).runSearchAnalyticsPaginated({
    family: "daily_totals",
    dimensions: ["date"],
    startDate: "2026-09-30",
    endDate: "2026-10-01",
  });
  assert.equal(report.requestCount, 2);
  assert.equal(report.rows.length, 2);
});

test("fails closed when the page cap would truncate", async () => {
  let page = 0;
  const fetchImpl = tokenThen(() => {
    page += 1;
    return json(200, {
      rows: [row([`2026-09-${String(10 + page * 2).padStart(2, "0")}`]), row([`2026-09-${String(11 + page * 2).padStart(2, "0")}`])],
    });
  });
  await assert.rejects(
    () =>
      client(fetchImpl, { maxPages: 2 }).runSearchAnalyticsPaginated({
        family: "daily_totals",
        dimensions: ["date"],
        startDate: "2026-09-30",
        endDate: "2026-10-01",
      }),
    /refusing to truncate/,
  );
});

test("search appearance queries one date at a time without a date dimension", async () => {
  const seen: Array<{ dimensions?: string[]; startDate?: string; endDate?: string }> = [];
  const fetchImpl = tokenThen((_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      dimensions?: string[];
      startDate?: string;
      endDate?: string;
    };
    seen.push(body);
    return json(200, {
      rows: [
        { keys: ["AMP_BLUE_LINK"], clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
      ],
    });
  });
  const report = await client(fetchImpl).runFamilyReport(
    reportDefinition("search_appearance"),
    "2026-09-30",
    "2026-10-01",
  );
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0].dimensions, ["searchAppearance"]);
  assert.equal(seen[0].startDate, seen[0].endDate);
  assert.equal(seen[1].startDate, seen[1].endDate);
  assert.notEqual(seen[0].startDate, seen[1].startDate);
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows[0].gscDate, "2026-09-30");
  assert.equal(report.rows[1].gscDate, "2026-10-01");
});

test("fails duplicate dimension keys across pages", async () => {
  const fetchImpl = tokenThen(() =>
    json(200, { rows: [row(["2026-09-30"]), row(["2026-09-30"])] }),
  );
  await assert.rejects(
    () =>
      client(fetchImpl).runSearchAnalyticsPaginated({
        family: "daily_totals",
        dimensions: ["date"],
        startDate: "2026-09-30",
        endDate: "2026-09-30",
      }),
    /duplicate dimension keys/,
  );
});
