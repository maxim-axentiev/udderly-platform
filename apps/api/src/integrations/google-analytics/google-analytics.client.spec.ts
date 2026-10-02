import assert from "node:assert/strict";
import test from "node:test";
import { GoogleAnalyticsClient } from "./google-analytics.client";
import { GoogleAnalyticsApiError } from "./google-analytics.errors";
import { GA_MAX_RETRIES, GA_TOKEN_URL } from "./google-analytics.constants";

function client(fetchImpl: typeof fetch, extra?: { reportPageLimit?: number }) {
  return new GoogleAnalyticsClient({
    clientId: "client-id",
    clientSecret: "super-secret",
    refreshToken: "refresh-secret",
    propertyId: "310874507",
    fetchImpl,
    reportPageLimit: extra?.reportPageLimit ?? 2,
    maxPages: 5,
    retryBackoffMs: 0,
  });
}

function json(status: number, body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function tokenThen(handler: (url: string, init?: RequestInit) => Response) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === GA_TOKEN_URL) {
      const body = String(init?.body ?? "");
      assert.ok(body.includes("grant_type=refresh_token"));
      return json(200, { access_token: "access-secret", expires_in: 3600 });
    }
    return handler(url, init);
  }) as typeof fetch;
}

function reportRow(date: string, extra: string[] = []) {
  return {
    dimensionValues: [{ value: date }, ...extra.map((value) => ({ value }))],
    metricValues: [{ value: "1" }],
  };
}

test("refreshes the access token before a read-only Admin GET", async () => {
  const fetchImpl = tokenThen((url) => {
    assert.ok(url.includes("/v1beta/properties/310874507"));
    assert.ok(!url.includes(":create"));
    return json(200, { name: "properties/310874507", timeZone: "America/Toronto" });
  });
  const payload = await client(fetchImpl).getProperty();
  assert.equal(payload.timeZone, "America/Toronto");
});

test("never includes secrets in API error messages", async () => {
  const fetchImpl = tokenThen(() =>
    json(400, { error: { message: "bad super-secret refresh-secret access-secret" } }),
  );
  await assert.rejects(
    () => client(fetchImpl).getProperty(),
    (error: unknown) => {
      assert.ok(error instanceof GoogleAnalyticsApiError);
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
  await assert.rejects(() => client(fetchImpl).getMetadata(), /HTTP 403/);
  assert.equal(calls, 1);
});

test("retries bounded 429 then fails", async () => {
  let calls = 0;
  const fetchImpl = tokenThen(() => {
    calls += 1;
    return json(429, { error: { message: "quota" } });
  });
  await assert.rejects(() => client(fetchImpl).getMetadata(), /HTTP 429/);
  assert.equal(calls, GA_MAX_RETRIES);
});

test("retries 503 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = tokenThen(() => {
    calls += 1;
    if (calls === 1) {
      return json(503, {});
    }
    return json(200, { dimensions: [] });
  });
  const payload = await client(fetchImpl).getMetadata();
  assert.deepEqual(payload.dimensions, []);
  assert.equal(calls, 2);
});

test("paginates a single complete page", async () => {
  const fetchImpl = tokenThen((_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { limit?: string };
    assert.equal(body.limit, "2");
    return json(200, {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "sessions" }],
      rowCount: 1,
      rows: [reportRow("20230401")],
    });
  });
  const report = await client(fetchImpl).runReportPaginated({
    family: "daily_totals",
    dimensions: ["date"],
    metrics: ["sessions"],
    startDate: "2023-04-01",
    endDate: "2023-04-01",
  });
  assert.equal(report.requestCount, 1);
  assert.equal(report.rowCount, 1);
  assert.equal(report.rows.length, 1);
});

test("paginates multiple pages until rowCount", async () => {
  const fetchImpl = tokenThen((_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { offset?: string };
    if (body.offset === "0") {
      return json(200, {
        dimensionHeaders: [{ name: "date" }],
        metricHeaders: [{ name: "sessions" }],
        rowCount: 3,
        rows: [reportRow("20230401"), reportRow("20230402")],
      });
    }
    assert.equal(body.offset, "2");
    return json(200, {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "sessions" }],
      rowCount: 3,
      rows: [reportRow("20230403")],
    });
  });
  const report = await client(fetchImpl).runReportPaginated({
    family: "daily_totals",
    dimensions: ["date"],
    metrics: ["sessions"],
    startDate: "2023-04-01",
    endDate: "2023-04-03",
  });
  assert.equal(report.requestCount, 2);
  assert.equal(report.rows.length, 3);
});

test("accepts an exact page-size boundary", async () => {
  const fetchImpl = tokenThen(() =>
    json(200, {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "sessions" }],
      rowCount: 2,
      rows: [reportRow("20230401"), reportRow("20230402")],
    }),
  );
  const report = await client(fetchImpl).runReportPaginated({
    family: "daily_totals",
    dimensions: ["date"],
    metrics: ["sessions"],
    startDate: "2023-04-01",
    endDate: "2023-04-02",
  });
  assert.equal(report.requestCount, 1);
  assert.equal(report.rows.length, 2);
});

test("fails incomplete pagination", async () => {
  const fetchImpl = tokenThen(() =>
    json(200, {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "sessions" }],
      rowCount: 4,
      rows: [reportRow("20230401")],
    }),
  );
  await assert.rejects(
    () =>
      client(fetchImpl).runReportPaginated({
        family: "daily_totals",
        dimensions: ["date"],
        metrics: ["sessions"],
        startDate: "2023-04-01",
        endDate: "2023-04-04",
      }),
    /stopped before rowCount/,
  );
});

test("fails when rowCount changes between pages", async () => {
  const fetchImpl = tokenThen((_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { offset?: string };
    if (body.offset === "0") {
      return json(200, {
        dimensionHeaders: [{ name: "date" }],
        metricHeaders: [{ name: "sessions" }],
        rowCount: 3,
        rows: [reportRow("20230401"), reportRow("20230402")],
      });
    }
    return json(200, {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "sessions" }],
      rowCount: 4,
      rows: [reportRow("20230403")],
    });
  });
  await assert.rejects(
    () =>
      client(fetchImpl).runReportPaginated({
        family: "daily_totals",
        dimensions: ["date"],
        metrics: ["sessions"],
        startDate: "2023-04-01",
        endDate: "2023-04-03",
      }),
    /rowCount changed/,
  );
});

test("fails duplicate dimension keys across pages", async () => {
  const fetchImpl = tokenThen(() =>
    json(200, {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "sessions" }],
      rowCount: 2,
      rows: [reportRow("20230401"), reportRow("20230401")],
    }),
  );
  await assert.rejects(
    () =>
      client(fetchImpl).runReportPaginated({
        family: "daily_totals",
        dimensions: ["date"],
        metrics: ["sessions"],
        startDate: "2023-04-01",
        endDate: "2023-04-01",
      }),
    /duplicate dimension keys/,
  );
});

test("checkCompatibility is POST read-only and runReport is the only Data write-shaped call", async () => {
  const methods: string[] = [];
  const fetchImpl = tokenThen((url, init) => {
    methods.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("checkCompatibility")) {
      return json(200, { dimensionCompatibilities: [] });
    }
    return json(200, {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "sessions" }],
      rowCount: 0,
      rows: [],
    });
  });
  const ga = client(fetchImpl);
  await ga.checkCompatibility(["date"], ["sessions"]);
  await ga.runReportPaginated({
    family: "daily_totals",
    dimensions: ["date"],
    metrics: ["sessions"],
    startDate: "2023-04-01",
    endDate: "2023-04-01",
  });
  assert.ok(methods.every((item) => item.startsWith("POST ") || item.startsWith("GET ")));
  assert.ok(methods.some((item) => item.includes(":checkCompatibility")));
  assert.ok(methods.some((item) => item.includes(":runReport")));
  assert.ok(!methods.some((item) => item.includes(":create") || item.includes(":delete")));
});
