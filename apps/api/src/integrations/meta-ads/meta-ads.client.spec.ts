import assert from "node:assert/strict";
import test from "node:test";
import { MetaAdsClient } from "./meta-ads.client";
import {
  META_ADS_CANONICAL_ACCOUNT_ID,
  META_ADS_MAX_RETRIES,
  META_GRAPH_API_BASE,
} from "./meta-ads.constants";
import { MetaAdsApiError } from "./meta-ads.errors";
import {
  insightRow,
  MOCK_ACCESS_TOKEN,
  mockAccount,
  mockCampaign,
} from "./meta-ads.fixtures";

function client(
  fetchImpl: typeof fetch,
  extra?: { pageLimit?: number; maxPages?: number },
) {
  return new MetaAdsClient({
    accessToken: MOCK_ACCESS_TOKEN,
    accountId: META_ADS_CANONICAL_ACCOUNT_ID,
    fetchImpl,
    pageLimit: extra?.pageLimit ?? 2,
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

test("rejects a non-canonical account id", () => {
  assert.throws(
    () =>
      new MetaAdsClient({
        accessToken: MOCK_ACCESS_TOKEN,
        accountId: "act_000",
      }),
    /meta_ads_account_id_not_canonical/,
  );
});

test("GET account is read-only and never puts the token in the query", async () => {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    assert.equal(init?.method, "GET");
    assert.ok(url.startsWith(`${META_GRAPH_API_BASE}/${META_ADS_CANONICAL_ACCOUNT_ID}`));
    assert.ok(!url.includes("access_token"));
    assert.ok(!url.includes(MOCK_ACCESS_TOKEN));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${MOCK_ACCESS_TOKEN}`);
    return json(200, mockAccount);
  }) as typeof fetch;
  const payload = await client(fetchImpl).getAccount();
  assert.equal(payload.currency, "CAD");
});

test("never includes secrets in API error messages", async () => {
  const fetchImpl = (async () =>
    json(400, {
      error: { message: `bad ${MOCK_ACCESS_TOKEN} token` },
    })) as typeof fetch;
  await assert.rejects(
    () => client(fetchImpl).getAccount(),
    (error: unknown) => {
      assert.ok(error instanceof MetaAdsApiError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.retryable, false);
      assert.ok(!error.message.includes(MOCK_ACCESS_TOKEN));
      assert.ok(error.message.includes("[redacted]"));
      return true;
    },
  );
});

test("4xx responses fail without retry", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return json(403, { error: { message: "forbidden" } });
  }) as typeof fetch;
  await assert.rejects(() => client(fetchImpl).getAccount(), /HTTP 403/);
  assert.equal(calls, 1);
});

test("retries bounded 429 then fails", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return json(429, { error: { message: "quota" } });
  }) as typeof fetch;
  await assert.rejects(() => client(fetchImpl).getAccount(), /HTTP 429/);
  assert.equal(calls, META_ADS_MAX_RETRIES);
});

test("retries 503 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) {
      return json(503, {});
    }
    return json(200, mockAccount);
  }) as typeof fetch;
  const payload = await client(fetchImpl).getAccount();
  assert.equal(payload.name, mockAccount.name);
  assert.equal(calls, 2);
});

test("empty insights are a complete report", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("time_increment"), "1");
    assert.equal(
      url.searchParams.get("action_attribution_windows"),
      JSON.stringify(["7d_click", "1d_view"]),
    );
    return json(200, { data: [] });
  }) as typeof fetch;
  const report = await client(fetchImpl).listInsights({
    level: "account",
    startDate: "2026-09-30",
    endDate: "2026-09-30",
  });
  assert.equal(report.rowCount, 0);
  assert.equal(report.rows.length, 0);
  assert.equal(report.requestCount, 1);
  assert.equal(report.attributionWindow, "7d_click,1d_view");
});

test("paginates with cursor after until paging ends", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const after = url.searchParams.get("after");
    if (!after) {
      return json(200, {
        data: [mockCampaign, { ...mockCampaign, id: "120210000000000002" }],
        paging: { cursors: { after: "cursor-2" }, next: "https://graph.facebook.com/next" },
      });
    }
    assert.equal(after, "cursor-2");
    return json(200, {
      data: [{ ...mockCampaign, id: "120210000000000003" }],
    });
  }) as typeof fetch;
  const page = await client(fetchImpl).listCampaigns();
  assert.equal(page.requestCount, 2);
  assert.equal(page.items.length, 3);
});

test("fails closed when paging.next has no cursor", async () => {
  const fetchImpl = (async () =>
    json(200, {
      data: [mockCampaign],
      paging: { next: "https://graph.facebook.com/next" },
    })) as typeof fetch;
  await assert.rejects(
    () => client(fetchImpl).listCampaigns(),
    /refusing to truncate/,
  );
});

test("fails closed when the page cap would truncate", async () => {
  let page = 0;
  const fetchImpl = (async () => {
    page += 1;
    return json(200, {
      data: [
        { ...mockCampaign, id: `id-${page}-a` },
        { ...mockCampaign, id: `id-${page}-b` },
      ],
      paging: { cursors: { after: `c-${page}` }, next: "https://graph.facebook.com/next" },
    });
  }) as typeof fetch;
  await assert.rejects(
    () => client(fetchImpl, { maxPages: 2 }).listCampaigns(),
    /refusing to truncate/,
  );
});

test("fails duplicate insight grains across pages", async () => {
  const fetchImpl = (async () =>
    json(200, {
      data: [insightRow(), insightRow()],
    })) as typeof fetch;
  await assert.rejects(
    () =>
      client(fetchImpl).listInsights({
        level: "account",
        startDate: "2026-09-30",
        endDate: "2026-09-30",
      }),
    /duplicate grains/,
  );
});

test("partial insight-level failure is fail-closed 4xx", async () => {
  let calls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls += 1;
    if (url.includes("/insights")) {
      return json(400, { error: { message: "partial" } });
    }
    return json(200, mockAccount);
  }) as typeof fetch;
  const ads = client(fetchImpl);
  await ads.getAccount();
  await assert.rejects(
    () =>
      ads.listInsights({
        level: "campaign",
        startDate: "2026-09-30",
        endDate: "2026-09-30",
      }),
    /HTTP 400/,
  );
  assert.equal(calls, 2);
});
