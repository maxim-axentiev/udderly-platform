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

test("batch retrieve requests exact ids at a catalog version including deleted", async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(_input));
    assert.equal(url.pathname, "/v2/catalog/batch-retrieve");
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      objects: [{ id: "V1", type: "ITEM_VARIATION" }],
      related_objects: [{ id: "I1", type: "ITEM" }],
    });
  }) as typeof fetch;

  try {
    const client = new SquareClient({
      accessToken: "synthetic-token",
      locationId: "L1",
      baseUrl: "https://square.test",
    });
    const result = await client.batchRetrieveCatalogObjects({
      objectIds: ["V1"],
      catalogVersion: 1740000000000,
      includeDeletedObjects: true,
      includeRelatedObjects: true,
    });
    assert.deepEqual(body, {
      object_ids: ["V1"],
      catalog_version: 1740000000000,
      include_deleted_objects: true,
      include_related_objects: true,
    });
    assert.equal(result.objects[0]?.id, "V1");
    assert.equal(result.relatedObjects[0]?.id, "I1");
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
