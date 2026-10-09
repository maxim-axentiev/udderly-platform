import assert from "node:assert/strict";
import test from "node:test";
import {
  MAILCHIMP_MAX_RETRIES,
} from "./mailchimp.constants";
import {
  MailchimpClient,
  assertMailchimpPathAllowed,
  mailchimpDataCenter,
} from "./mailchimp.client";
import { MailchimpApiError } from "./mailchimp.errors";
import {
  MOCK_MAILCHIMP_API_KEY,
  mockAccount,
  mockAudience,
  mockCampaign,
} from "./mailchimp.fixtures";

function client(
  fetchImpl: typeof fetch,
  extra?: { pageCount?: number; maxPages?: number },
) {
  return new MailchimpClient({
    apiKey: MOCK_MAILCHIMP_API_KEY,
    fetchImpl,
    pageCount: extra?.pageCount ?? 2,
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

test("data center comes from the key suffix without exposing the key", () => {
  assert.equal(mailchimpDataCenter(MOCK_MAILCHIMP_API_KEY), "us21");
  assert.throws(() => mailchimpDataCenter("no-suffix"), /mailchimp_data_center_unreadable/);
});

test("GET account is read-only Basic auth and never puts the key in the URL", async () => {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    assert.equal(init?.method, "GET");
    assert.ok(url.startsWith("https://us21.api.mailchimp.com/3.0"));
    assert.ok(url.includes("account_timezone"));
    assert.ok(!url.includes(MOCK_MAILCHIMP_API_KEY));
    assert.ok(!url.toLowerCase().includes("apikey"));
    const headers = new Headers(init?.headers);
    const auth = headers.get("Authorization") ?? "";
    assert.ok(auth.startsWith("Basic "));
    assert.ok(!auth.includes(MOCK_MAILCHIMP_API_KEY));
    return json(200, mockAccount);
  }) as typeof fetch;
  const payload = await client(fetchImpl).getAccount();
  assert.equal(payload.account_name, mockAccount.account_name);
});

test("never includes secrets in API error messages", async () => {
  const fetchImpl = (async () =>
    json(400, { detail: `bad ${MOCK_MAILCHIMP_API_KEY} key` })) as typeof fetch;
  await assert.rejects(
    () => client(fetchImpl).getAccount(),
    (error: unknown) => {
      assert.ok(error instanceof MailchimpApiError);
      assert.equal(error.statusCode, 400);
      assert.ok(!error.message.includes(MOCK_MAILCHIMP_API_KEY));
      assert.ok(error.message.includes("[redacted]"));
      return true;
    },
  );
});

test("4xx responses fail without retry", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return json(403, { title: "forbidden" });
  }) as typeof fetch;
  await assert.rejects(() => client(fetchImpl).getAccount(), /HTTP 403/);
  assert.equal(calls, 1);
});

test("retries bounded 429 then fails", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return json(429, { title: "quota" });
  }) as typeof fetch;
  await assert.rejects(() => client(fetchImpl).getAccount(), /HTTP 429/);
  assert.equal(calls, MAILCHIMP_MAX_RETRIES);
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
  assert.equal(payload.account_id, mockAccount.account_id);
  assert.equal(calls, 2);
});

test("paginates with count/offset until total_items", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const offset = url.searchParams.get("offset");
    if (offset === "0") {
      return json(200, {
        lists: [mockAudience, { ...mockAudience, id: "list002" }],
        total_items: 3,
      });
    }
    assert.equal(offset, "2");
    return json(200, {
      lists: [{ ...mockAudience, id: "list003" }],
      total_items: 3,
    });
  }) as typeof fetch;
  const page = await client(fetchImpl).listAudiences();
  assert.equal(page.requestCount, 2);
  assert.equal(page.items.length, 3);
  assert.equal(page.totalItems, 3);
});

test("fails closed when total_items is omitted", async () => {
  const fetchImpl = (async () =>
    json(200, { lists: [mockAudience] })) as typeof fetch;
  await assert.rejects(() => client(fetchImpl).listAudiences(), /refusing to truncate/);
});

test("fails closed when the page cap would truncate", async () => {
  let page = 0;
  const fetchImpl = (async () => {
    page += 1;
    return json(200, {
      campaigns: [
        { ...mockCampaign, id: `id-${page}-a` },
        { ...mockCampaign, id: `id-${page}-b` },
      ],
      total_items: 20,
    });
  }) as typeof fetch;
  await assert.rejects(
    () => client(fetchImpl, { maxPages: 2 }).listSentCampaigns(),
    /refusing to truncate/,
  );
});

test("member endpoints are forbidden", () => {
  assert.throws(
    () => assertMailchimpPathAllowed("/lists/abc/members"),
    /mailchimp_forbidden_pii_endpoint/,
  );
  assert.throws(
    () => assertMailchimpPathAllowed("/reports/camp/click-details/link/members"),
    /mailchimp_forbidden_pii_endpoint/,
  );
  assert.throws(
    () => assertMailchimpPathAllowed("/reports/camp/email-activity"),
    /mailchimp_forbidden_pii_endpoint/,
  );
  assertMailchimpPathAllowed("/reports/camp/click-details");
});

test("empty collections are complete", async () => {
  const fetchImpl = (async () =>
    json(200, { reports: [], total_items: 0 })) as typeof fetch;
  const page = await client(fetchImpl).listReports();
  assert.equal(page.items.length, 0);
  assert.equal(page.totalItems, 0);
});
