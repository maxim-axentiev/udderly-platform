export const NAMING_CAMPAIGN_TIER_CENTS = [10_000, 25_000, 50_000, 100_000] as const;

/** Confirmed FareHarbor gift-card item. Do not replace this with an unverified id. */
export const CONFIRMED_FAREHARBOR_GIFT_CARD_ITEM_ID = "308290";

/** Confirmed FareHarbor booking flow for item 308290. */
export const CONFIRMED_FAREHARBOR_GIFT_CARD_FLOW_ID = "573099";

const FAREHARBOR_COMPANY = "udderlyridiculousfarmlife";
const CHECKOUT_REF = /^[A-Za-z0-9_-]{1,128}$/;
const POSITIVE_ID = /^[1-9][0-9]{0,11}$/;
const TIER_ENTRY = /^([1-9][0-9]*):([1-9][0-9]*):([1-9][0-9]*)$/;

export type FareharborTierCheckout = {
  priceCents: number;
  itemId: string;
  flowId: string;
};

export class FareharborTierConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FareharborTierConfigError";
  }
}

export function defaultFareharborTierCheckouts(): FareharborTierCheckout[] {
  return NAMING_CAMPAIGN_TIER_CENTS.map((priceCents) => ({
    priceCents,
    itemId: CONFIRMED_FAREHARBOR_GIFT_CARD_ITEM_ID,
    flowId: CONFIRMED_FAREHARBOR_GIFT_CARD_FLOW_ID,
  }));
}

/**
 * `NAMING_FAREHARBOR_TIERS` is `priceCents:itemId:flowId` repeated for every
 * campaign tier, separated by commas. An empty value keeps item 308290 and
 * flow 573099 on all four tiers. A partial or unknown price fails closed.
 */
export function parseFareharborTierCheckouts(
  raw: string | undefined | null,
): FareharborTierCheckout[] {
  if (raw == null || raw.trim() === "") {
    return defaultFareharborTierCheckouts();
  }

  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  const parsed: FareharborTierCheckout[] = [];
  for (const part of parts) {
    const match = TIER_ENTRY.exec(part);
    if (!match || !POSITIVE_ID.test(match[2]) || !POSITIVE_ID.test(match[3])) {
      throw new FareharborTierConfigError(
        "NAMING_FAREHARBOR_TIERS entries must be priceCents:itemId:flowId",
      );
    }
    const priceCents = Number(match[1]);
    if (!Number.isSafeInteger(priceCents)) {
      throw new FareharborTierConfigError(
        "NAMING_FAREHARBOR_TIERS contains a price that is not a safe integer",
      );
    }
    parsed.push({ priceCents, itemId: match[2], flowId: match[3] });
  }

  const seen = new Set<number>();
  for (const tier of parsed) {
    if (seen.has(tier.priceCents)) {
      throw new FareharborTierConfigError(
        "NAMING_FAREHARBOR_TIERS contains a duplicate tier price",
      );
    }
    seen.add(tier.priceCents);
  }
  for (const priceCents of NAMING_CAMPAIGN_TIER_CENTS) {
    if (!seen.has(priceCents)) {
      throw new FareharborTierConfigError(
        `NAMING_FAREHARBOR_TIERS is missing the ${priceCents} cent tier`,
      );
    }
  }
  if (parsed.length !== NAMING_CAMPAIGN_TIER_CENTS.length) {
    throw new FareharborTierConfigError(
      "NAMING_FAREHARBOR_TIERS contains a price outside the four campaign tiers",
    );
  }

  return NAMING_CAMPAIGN_TIER_CENTS.map((priceCents) => {
    const tier = parsed.find((entry) => entry.priceCents === priceCents);
    if (!tier) {
      throw new FareharborTierConfigError(
        `NAMING_FAREHARBOR_TIERS is missing the ${priceCents} cent tier`,
      );
    }
    return tier;
  });
}

export function fareharborTierCheckoutForPrice(
  tiers: readonly FareharborTierCheckout[],
  priceCents: number,
): FareharborTierCheckout | undefined {
  return tiers.find((tier) => tier.priceCents === priceCents);
}

export function fareharborConfiguredItemIds(
  tiers: readonly FareharborTierCheckout[],
): ReadonlySet<string> {
  return new Set(tiers.map((tier) => tier.itemId));
}

/** Configured tier items plus the confirmed item, so an older 308290 refund can still be read. */
export function fareharborAcceptedItemIds(
  tiers: readonly FareharborTierCheckout[],
): ReadonlySet<string> {
  return new Set([
    CONFIRMED_FAREHARBOR_GIFT_CARD_ITEM_ID,
    ...tiers.map((tier) => tier.itemId),
  ]);
}

/**
 * The item a reservation must have paid. A campaign tier with no mapping fails
 * closed. A non-tier price, such as an already claimed test object, still
 * expects the confirmed item.
 */
export function expectedFareharborItemId(
  tiers: readonly FareharborTierCheckout[],
  priceCents: number,
): string | undefined {
  const mapped = fareharborTierCheckoutForPrice(tiers, priceCents);
  if (mapped) {
    return mapped.itemId;
  }
  if ((NAMING_CAMPAIGN_TIER_CENTS as readonly number[]).includes(priceCents)) {
    return undefined;
  }
  return CONFIRMED_FAREHARBOR_GIFT_CARD_ITEM_ID;
}

export function fareharborCheckoutPairs(
  tiers: readonly FareharborTierCheckout[],
): Array<{ itemId: string; flowId: string }> {
  const seen = new Set<string>();
  const pairs: Array<{ itemId: string; flowId: string }> = [];
  for (const tier of tiers) {
    const key = `${tier.itemId}:${tier.flowId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    pairs.push({ itemId: tier.itemId, flowId: tier.flowId });
  }
  return pairs;
}

export function fareharborCheckoutUrl(
  checkout: Pick<FareharborTierCheckout, "itemId" | "flowId">,
  checkoutRef: string,
): string {
  if (!POSITIVE_ID.test(checkout.itemId) || !POSITIVE_ID.test(checkout.flowId)) {
    throw new FareharborTierConfigError("FareHarbor item and flow ids must be decimal ids");
  }
  if (!CHECKOUT_REF.test(checkoutRef)) {
    throw new FareharborTierConfigError("FareHarbor checkout reference is not valid");
  }
  const url = new URL(
    `https://fareharbor.com/embeds/book/${FAREHARBOR_COMPANY}/items/${checkout.itemId}/`,
  );
  url.searchParams.set("full-items", "yes");
  url.searchParams.set("flow", checkout.flowId);
  url.searchParams.set("ref", checkoutRef);
  return url.toString();
}

export function isFareharborCheckoutUrl(
  value: string,
  allowList: ReadonlyArray<{ itemId: string; flowId: string }> = fareharborCheckoutPairs(
    defaultFareharborTierCheckouts(),
  ),
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    !value.startsWith("https://fareharbor.com/") ||
    url.protocol !== "https:" ||
    url.hostname !== "fareharbor.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== ""
  ) {
    return false;
  }
  const keys = [...url.searchParams.keys()];
  if (keys.join(",") !== "full-items,flow,ref") {
    return false;
  }
  if (
    url.searchParams.getAll("full-items").length !== 1 ||
    url.searchParams.getAll("flow").length !== 1 ||
    url.searchParams.getAll("ref").length !== 1
  ) {
    return false;
  }
  const ref = url.searchParams.get("ref");
  if (
    url.searchParams.get("full-items") !== "yes" ||
    ref == null ||
    !CHECKOUT_REF.test(ref)
  ) {
    return false;
  }
  const flowId = url.searchParams.get("flow");
  return allowList.some(
    (pair) =>
      POSITIVE_ID.test(pair.itemId) &&
      POSITIVE_ID.test(pair.flowId) &&
      url.pathname ===
        `/embeds/book/${FAREHARBOR_COMPANY}/items/${pair.itemId}/` &&
      flowId === pair.flowId,
  );
}
