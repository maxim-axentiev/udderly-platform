import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ROBOTS_DIRECTIVE, ROBOTS_TXT } from "./robots";

test("the pre-launch robots file discourages crawling", () => {
  const file = readFileSync(new URL("../../public/robots.txt", import.meta.url), "utf8");
  assert.equal(file, ROBOTS_TXT);
  assert.match(ROBOTS_TXT, /^User-agent: \*\r?\nDisallow: \/\r?\n$/);
  assert.equal(ROBOTS_DIRECTIVE, "noindex, nofollow");
  assert.doesNotMatch(ROBOTS_TXT, /Allow:/);
});
