import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCountString,
  parseMajorCurrencyToMinorUnits,
  parseMinorUnitString,
} from "./meta-ads.money";

test("Insights spend major units become CAD cents", () => {
  assert.equal(parseMajorCurrencyToMinorUnits("12.34", "CAD"), 1234);
  assert.equal(parseMajorCurrencyToMinorUnits("0.01", "CAD"), 1);
  assert.equal(parseMajorCurrencyToMinorUnits("12", "CAD"), 1200);
  assert.equal(parseMajorCurrencyToMinorUnits("12.3", "CAD"), 1230);
});

test("rejects non-CAD and extra-precision spend", () => {
  assert.throws(() => parseMajorCurrencyToMinorUnits("12.34", "USD"), /currency_not_cad/);
  assert.throws(() => parseMajorCurrencyToMinorUnits("12.345", "CAD"), /spend_malformed/);
});

test("structure budgets stay integer minor units", () => {
  assert.equal(parseMinorUnitString("2500"), 2500);
});

test("counts reject decimals", () => {
  assert.equal(parseCountString("100"), 100);
  assert.throws(() => parseCountString("1.5"), /count_malformed/);
});
