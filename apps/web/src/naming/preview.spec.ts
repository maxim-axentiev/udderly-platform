import assert from "node:assert/strict";
import test from "node:test";
import { isNamingPreviewMode, previewObjects } from "./preview";

test("preview mode is on only for the exact true value", () => {
  assert.equal(isNamingPreviewMode("true"), true);
  assert.equal(isNamingPreviewMode("false"), false);
  assert.equal(isNamingPreviewMode(""), false);
  assert.equal(isNamingPreviewMode(undefined), false);
  assert.equal(isNamingPreviewMode("TRUE"), false);
});

test("preview catalog uses the four campaign tiers and sample states", () => {
  assert.deepEqual(
    previewObjects.map((object) => [
      object.name,
      object.priceCents,
      object.availability,
    ]),
    [
      ["Blue Bucket", 10_000, "available"],
      ["Goat Slide", 25_000, "held"],
      ["Yellow Tractor", 50_000, "claimed"],
      ["Goat Tower", 100_000, "available"],
    ],
  );
  assert.equal(new Set(previewObjects.map((object) => object.id)).size, 4);
  for (const object of previewObjects) {
    assert.equal(object.photoUrl, null);
    assert.match(object.description, /sample/i);
    assert.equal(object.id.startsWith("preview-"), true);
    assert.equal(object.id.includes("-"), true);
    assert.equal(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        object.id,
      ),
      false,
    );
  }
});
