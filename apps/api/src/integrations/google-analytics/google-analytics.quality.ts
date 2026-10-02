import type { GaQuality, GoogleAnalyticsJson } from "./google-analytics.types";

export function evaluateReportQuality(payload: GoogleAnalyticsJson): GaQuality {
  const metadata =
    payload.metadata && typeof payload.metadata === "object"
      ? (payload.metadata as GoogleAnalyticsJson)
      : {};
  const sampling = metadata.samplingMetadatas;
  return {
    subjectToThresholding: metadata.subjectToThresholding === true,
    dataLossFromOtherRow: metadata.dataLossFromOtherRow === true,
    sampled: Array.isArray(sampling) ? sampling.length > 0 : Boolean(sampling),
  };
}

export function qualityFailure(quality: GaQuality): string | undefined {
  if (quality.sampled) {
    return "google_analytics_sampled_report";
  }
  if (quality.dataLossFromOtherRow) {
    return "google_analytics_data_loss_from_other_row";
  }
  if (quality.subjectToThresholding) {
    return "google_analytics_provider_thresholded_data_suppressed";
  }
  return undefined;
}
