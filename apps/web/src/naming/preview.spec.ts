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

test("preview catalog is three labelled sample objects with buying left off", () => {
  assert.deepEqual(
    previewObjects.map((object) => [object.name, object.priceCents]),
    [
      ["Wheelbarrow", 10_000],
      ["Poop Vacuum", 35_000],
      ["Tractor", 50_000],
    ],
  );
  assert.equal(new Set(previewObjects.map((object) => object.id)).size, 3);
  for (const object of previewObjects) {
    assert.equal(object.photoUrl, null);
    assert.equal(object.availability, "available");
    assert.match(object.description, /sample/i);
    assert.equal(object.id.startsWith("preview-"), true);
  }
});
