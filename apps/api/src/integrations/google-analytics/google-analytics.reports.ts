import {
  FORBIDDEN_CUSTOM_DIMENSION_NAMES,
  FORBIDDEN_DIMENSION_SUBSTRINGS,
} from "./google-analytics.constants";

export type GaReportFamilyId =
  | "daily_totals"
  | "daily_engagement"
  | "ecommerce_totals"
  | "session_acquisition"
  | "first_user_acquisition"
  | "landing_page"
  | "page_path"
  | "event"
  | "country"
  | "device"
  | "ecommerce_item";

export type GaReportDefinition = {
  id: GaReportFamilyId;
  canonicalFamily: GaCanonicalFamily;
  dimensions: string[];
  metrics: string[];
  highCardinality: boolean;
};

export type GaCanonicalFamily =
  | "daily_totals"
  | "session_acquisition"
  | "first_user_acquisition"
  | "landing_page"
  | "page_path"
  | "event"
  | "country"
  | "device"
  | "ecommerce_item";

export const GA_REPORT_DEFINITIONS: readonly GaReportDefinition[] = [
  {
    id: "daily_totals",
    canonicalFamily: "daily_totals",
    dimensions: ["date"],
    metrics: [
      "sessions",
      "activeUsers",
      "newUsers",
      "engagedSessions",
      "engagementRate",
      "bounceRate",
      "eventCount",
      "screenPageViews",
      "keyEvents",
      "averageSessionDuration",
    ],
    highCardinality: false,
  },
  {
    id: "daily_engagement",
    canonicalFamily: "daily_totals",
    dimensions: ["date"],
    metrics: ["userEngagementDuration", "totalUsers"],
    highCardinality: false,
  },
  {
    id: "ecommerce_totals",
    canonicalFamily: "daily_totals",
    dimensions: ["date"],
    metrics: [
      "ecommercePurchases",
      "transactions",
      "purchaseRevenue",
      "itemsPurchased",
      "addToCarts",
    ],
    highCardinality: false,
  },
  {
    id: "session_acquisition",
    canonicalFamily: "session_acquisition",
    dimensions: [
      "date",
      "sessionSource",
      "sessionMedium",
      "sessionDefaultChannelGroup",
    ],
    metrics: ["sessions", "engagedSessions", "keyEvents", "bounceRate"],
    highCardinality: false,
  },
  {
    id: "first_user_acquisition",
    canonicalFamily: "first_user_acquisition",
    dimensions: [
      "date",
      "firstUserSource",
      "firstUserMedium",
      "firstUserDefaultChannelGroup",
    ],
    metrics: ["newUsers", "activeUsers"],
    highCardinality: false,
  },
  {
    id: "landing_page",
    canonicalFamily: "landing_page",
    dimensions: ["date", "landingPage"],
    metrics: ["sessions", "engagedSessions", "keyEvents", "activeUsers"],
    highCardinality: true,
  },
  {
    id: "page_path",
    canonicalFamily: "page_path",
    dimensions: ["date", "pagePath"],
    metrics: ["screenPageViews", "eventCount", "activeUsers"],
    highCardinality: true,
  },
  {
    id: "event",
    canonicalFamily: "event",
    dimensions: ["date", "eventName"],
    metrics: ["eventCount", "activeUsers", "keyEvents"],
    highCardinality: true,
  },
  {
    id: "country",
    canonicalFamily: "country",
    dimensions: ["date", "country"],
    metrics: ["sessions", "activeUsers"],
    highCardinality: false,
  },
  {
    id: "device",
    canonicalFamily: "device",
    dimensions: ["date", "deviceCategory"],
    metrics: ["sessions", "engagedSessions", "activeUsers"],
    highCardinality: false,
  },
  {
    id: "ecommerce_item",
    canonicalFamily: "ecommerce_item",
    dimensions: ["date", "itemId"],
    metrics: [
      "itemsViewed",
      "itemsAddedToCart",
      "itemsPurchased",
      "itemRevenue",
    ],
    highCardinality: true,
  },
];

export function isGaReportFamilyId(id: string): id is GaReportFamilyId {
  return GA_REPORT_DEFINITIONS.some((item) => item.id === id);
}

export function reportDefinition(id: string): GaReportDefinition {
  if (!isGaReportFamilyId(id)) {
    throw new Error("unknown_report_family");
  }
  const found = GA_REPORT_DEFINITIONS.find((item) => item.id === id);
  if (!found) {
    throw new Error("unknown_report_family");
  }
  assertSafeDimensions(found.dimensions);
  return found;
}

export function assertSafeDimensions(dimensions: string[]): void {
  for (const dimension of dimensions) {
    if (isForbiddenDimension(dimension)) {
      throw new Error(`forbidden_dimension:${dimension}`);
    }
  }
}

export function isForbiddenDimension(name: string): boolean {
  const lower = name.toLowerCase();
  if (
    FORBIDDEN_CUSTOM_DIMENSION_NAMES.some(
      (item) => item.toLowerCase() === lower,
    )
  ) {
    return true;
  }
  return FORBIDDEN_DIMENSION_SUBSTRINGS.some((part) =>
    lower.includes(part.toLowerCase()),
  );
}

/** Fail-closed cross-family additivity. `sessions` is HLL++ estimated and is not in this list. */
export const ADDITIVE_DAILY_METRICS = ["eventCount"] as const;
