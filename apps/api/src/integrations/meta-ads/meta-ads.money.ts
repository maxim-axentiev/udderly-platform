import { META_ADS_CANONICAL_CURRENCY } from "./meta-ads.constants";

const DOLLAR = /^-?\d+(?:\.\d{1,2})?$/;
const CENTS = /^-?\d+$/;

/**
 * Insights `spend` is a major-unit decimal string in account currency.
 * Canonical money is integer minor units (CAD $12.34 → 1234).
 */
export function parseMajorCurrencyToMinorUnits(
  value: string,
  currency: string,
): number {
  if (currency !== META_ADS_CANONICAL_CURRENCY) {
    throw new Error("meta_ads_currency_not_cad");
  }
  const trimmed = value.trim();
  if (!DOLLAR.test(trimmed)) {
    throw new Error("meta_ads_spend_malformed");
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = unsigned.split(".");
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
  if (!Number.isSafeInteger(cents)) {
    throw new Error("meta_ads_spend_malformed");
  }
  return negative ? -cents : cents;
}

/** Insights impression/click/reach counts are integer strings. */
export function parseCountString(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("meta_ads_count_malformed");
  }
  const amount = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(amount)) {
    throw new Error("meta_ads_count_malformed");
  }
  return amount;
}

/** Structure budgets from Marketing API are already minor-unit integer strings. */
export function parseMinorUnitString(value: string): number {
  const trimmed = value.trim();
  if (!CENTS.test(trimmed)) {
    throw new Error("meta_ads_minor_units_malformed");
  }
  const amount = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(amount)) {
    throw new Error("meta_ads_minor_units_malformed");
  }
  return amount;
}
