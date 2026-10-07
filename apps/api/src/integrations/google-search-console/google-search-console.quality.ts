import type { GscCompletedReport } from "./google-search-console.types";
import { GSC_DATA_STATE, GSC_SEARCH_TYPE } from "./google-search-console.constants";

export function qualityFailure(report: {
  dataState?: string;
  searchType?: string;
}): string | undefined {
  if (report.dataState !== GSC_DATA_STATE) {
    return "google_search_console_non_final_data";
  }
  if (report.searchType !== GSC_SEARCH_TYPE) {
    return "google_search_console_non_web_search_type";
  }
  return undefined;
}

export function assertReportQuality(report: GscCompletedReport): void {
  const error = qualityFailure(report);
  if (error) {
    throw new Error(`${error} family=${report.family}`);
  }
}
