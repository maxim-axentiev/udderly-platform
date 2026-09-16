import assert from "node:assert/strict";
import test from "node:test";
import { SquareClient } from "./square.client";

test("catalog list follows Square cursor until the last page", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.pathname, "/v2/catalog/list");
    assert.equal(url.searchParams.get("types"), "CATEGORY,ITEM,ITEM_VARIATION");
    const cursor = url.searchParams.get("cursor");
    if (!cursor) {
      return jsonResponse({
        objects: [{ type: "CATEGORY", id: "page-1" }],
        cursor: "next-page",
      });
    }
    assert.equal(cursor, "next-page");
    return jsonResponse({
      objects: [{ type: "CATEGORY", id: "page-2" }],
    });
  }) as typeof fetch;

  try {
    const client = new SquareClient({
      accessToken: "synthetic-token",
      locationId: "L1",
      baseUrl: "https://square.test",
    });
    const objects = await client.listCatalog([
      "CATEGORY",
      "ITEM",
      "ITEM_VARIATION",
    ]);
    assert.equal(calls, 2);
    assert.deepEqual(
      objects.map((object) => object.id),
      ["page-1", "page-2"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
