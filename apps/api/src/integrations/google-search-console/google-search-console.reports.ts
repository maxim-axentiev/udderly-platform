export type GscReportFamilyId =
  | "daily_totals"
  | "query"
  | "page"
  | "country"
  | "device"
  | "search_appearance";

export type GscReportDefinition = {
  id: GscReportFamilyId;
  dimensions: string[];
};

export const GSC_METRICS = [
  "clicks",
  "impressions",
  "ctr",
  "position",
] as const;

export const GSC_REPORT_DEFINITIONS: readonly GscReportDefinition[] = [
  { id: "daily_totals", dimensions: ["date"] },
  { id: "query", dimensions: ["date", "query"] },
  { id: "page", dimensions: ["date", "page"] },
  { id: "country", dimensions: ["date", "country"] },
  { id: "device", dimensions: ["date", "device"] },
  // Google forbids combining searchAppearance with any other dimension, including date.
  { id: "search_appearance", dimensions: ["searchAppearance"] },
];

export function reportDefinition(
  family: string,
): GscReportDefinition {
  const found = GSC_REPORT_DEFINITIONS.find((item) => item.id === family);
  if (!found) {
    throw new Error("unknown_report_family");
  }
  return found;
}

export function isGscReportFamilyId(value: string): value is GscReportFamilyId {
  return GSC_REPORT_DEFINITIONS.some((item) => item.id === value);
}
