import assert from "node:assert/strict";
import test from "node:test";
import { SquareClient } from "./square.client";

test("order search follows Square cursor until the last page", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      cursor?: string;
      query?: {
        filter?: {
          date_time_filter?: { closed_at?: unknown; created_at?: unknown };
        };
      };
    };
    assert.ok(body.query?.filter?.date_time_filter?.closed_at);
    assert.equal(body.query?.filter?.date_time_filter?.created_at, undefined);
    if (!body.cursor) {
      return jsonResponse({
        orders: [{ id: "order-page-1" }],
        cursor: "next-page",
      });
    }
    assert.equal(body.cursor, "next-page");
    return jsonResponse({
      orders: [{ id: "order-page-2" }],
    });
  }) as typeof fetch;

  try {
    const objects = await client().searchOrders(
      {
        startAt: "2026-09-15T04:00:00.000Z",
        endAt: "2026-09-16T04:00:00.000Z",
      },
      { dateField: "closed_at" },
    );
    assert.equal(calls, 2);
    assert.deepEqual(
      objects.map((object) => object.id),
      ["order-page-1", "order-page-2"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("payments list follows Square cursor until the last page", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.pathname, "/v2/payments");
    const cursor = url.searchParams.get("cursor");
    if (!cursor) {
      return jsonResponse({
        payments: [{ id: "pay-page-1" }],
        cursor: "next-page",
      });
    }
    assert.equal(cursor, "next-page");
    return jsonResponse({
      payments: [{ id: "pay-page-2" }],
    });
  }) as typeof fetch;

  try {
    const objects = await client().listPayments({
      startAt: "2026-09-15T04:00:00.000Z",
      endAt: "2026-09-16T04:00:00.000Z",
    });
    assert.equal(calls, 2);
    assert.deepEqual(
      objects.map((object) => object.id),
      ["pay-page-1", "pay-page-2"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refunds list follows Square cursor until the last page", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.pathname, "/v2/refunds");
    const cursor = url.searchParams.get("cursor");
    if (!cursor) {
      return jsonResponse({
        refunds: [{ id: "ref-page-1" }],
        cursor: "next-page",
      });
    }
    assert.equal(cursor, "next-page");
    return jsonResponse({
      refunds: [{ id: "ref-page-2" }],
    });
  }) as typeof fetch;

  try {
    const objects = await client().listRefunds({
      startAt: "2026-09-15T04:00:00.000Z",
      endAt: "2026-09-16T04:00:00.000Z",
    });
    assert.equal(calls, 2);
    assert.deepEqual(
      objects.map((object) => object.id),
      ["ref-page-1", "ref-page-2"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function client(): SquareClient {
  return new SquareClient({
    accessToken: "synthetic-token",
    locationId: "L1",
    baseUrl: "https://square.test",
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
