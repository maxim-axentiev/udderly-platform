import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSubmittedName } from "./naming-link";
import { parseNamingLinkCommand } from "./naming-link.command";

const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";

test("issue command accepts a reservation and explicit reissue", () => {
  assert.deepEqual(parseNamingLinkCommand(["issue", "--reservation", RESERVATION_ID]), {
    action: "issue",
    reservationId: RESERVATION_ID,
    reissue: false,
  });
  assert.equal(
    parseNamingLinkCommand([
      "issue",
      `--reservation=${RESERVATION_ID}`,
      "--reissue",
    ])?.reissue,
    true,
  );
  assert.equal(parseNamingLinkCommand(["issue"]), undefined);
  assert.equal(parseNamingLinkCommand(["issue", "--reservation", "nope"]), undefined);
});

test("submitted names must be visible text within 40 characters", () => {
  assert.equal(normalizeSubmittedName("  Buttercup  "), "Buttercup");
  assert.equal(normalizeSubmittedName("O'Brien-Jane"), "O'Brien-Jane");
  assert.equal(normalizeSubmittedName("é"), "é");
  assert.equal(normalizeSubmittedName("a".repeat(40)), "a".repeat(40));
  assert.equal(normalizeSubmittedName(""), undefined);
  assert.equal(normalizeSubmittedName("   "), undefined);
  assert.equal(normalizeSubmittedName("a".repeat(41)), undefined);
  assert.equal(normalizeSubmittedName("North\ngate"), undefined);
  assert.equal(normalizeSubmittedName("North\u0000gate"), undefined);
  assert.equal(normalizeSubmittedName("<script>"), undefined);
  assert.equal(normalizeSubmittedName("Barn > Shed"), undefined);
});
