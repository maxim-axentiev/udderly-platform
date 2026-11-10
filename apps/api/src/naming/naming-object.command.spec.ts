import assert from "node:assert/strict";
import test from "node:test";
import { parseNamingObjectCommand } from "./naming-object.command";

test("add stays unpublished unless publish is explicit", () => {
  const unpublished = parseNamingObjectCommand([
    "add",
    "--name",
    "North gate",
    "--price",
    "2000",
    "--description",
    "Cedar gate",
    "--photo-url",
    "https://example.com/gate.jpg",
  ]);
  assert.deepEqual(unpublished, {
    action: "add",
    name: "North gate",
    description: "Cedar gate",
    priceAmount: 2000,
    photoUrl: "https://example.com/gate.jpg",
    publish: false,
  });

  const published = parseNamingObjectCommand([
    "add",
    "--name=North gate",
    "--price=2000",
    "--publish",
  ]);
  assert.equal(published?.action, "add");
  if (published?.action === "add") {
    assert.equal(published.publish, true);
    assert.equal(published.description, "");
    assert.equal(published.photoUrl, null);
  }
});

test("add rejects missing name, fractional price, and negative price", () => {
  assert.equal(
    parseNamingObjectCommand(["add", "--price", "2000"]),
    undefined,
  );
  assert.equal(
    parseNamingObjectCommand([
      "add",
      "--name",
      "North gate",
      "--price",
      "20.00",
    ]),
    undefined,
  );
  assert.equal(
    parseNamingObjectCommand(["add", "--name", "North gate", "--price", "-1"]),
    undefined,
  );
});

test("edit accepts one change and rejects conflicting publication flags", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const edited = parseNamingObjectCommand([
    "edit",
    "--id",
    id,
    "--unpublish",
  ]);
  assert.deepEqual(edited, { action: "edit", id, publish: false });
  assert.equal(
    parseNamingObjectCommand(["edit", "--id", id, "--publish", "--unpublish"]),
    undefined,
  );
  assert.equal(parseNamingObjectCommand(["edit", "--id", id]), undefined);
  assert.equal(parseNamingObjectCommand(["list", "--publish"]), undefined);
});
