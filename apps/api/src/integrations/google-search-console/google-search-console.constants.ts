export const GOOGLE_SEARCH_CONSOLE_PROVIDER = "google_search_console";

export const GSC_CANONICAL_SITE_URL =
  "sc-domain:udderlyridiculousfarmlife.com";

export const GSC_SITE_ENTITY = "site";
export const GSC_REPORT_ENTITY = "report";

export const GSC_API_BASE = "https://www.googleapis.com/webmasters/v3";
export const GSC_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GSC_READONLY_SCOPE =
  "https://www.googleapis.com/auth/webmasters.readonly";

export const GSC_DATA_STATE = "final" as const;
export const GSC_SEARCH_TYPE = "web" as const;

export const GSC_MAX_RETRIES = 4;
export const GSC_REQUEST_TIMEOUT_MS = 60_000;
export const GSC_REPORT_ROW_LIMIT = 25_000;
export const GSC_MAX_PAGES = 50;

/** Search Analytics civil dates (not America/Toronto farm dates). */
export const GSC_REPORTING_TIME_ZONE = "America/Los_Angeles";

export const GSC_EARLIEST_USEFUL_DATE = "2026-09-30";

/** Completed reporting-calendar offsets. Not a contiguous range. */
export const GSC_INCREMENTAL_DAY_OFFSETS = [2, 3, 7, 14] as const;

export const GSC_INCREMENTAL_LOCK_NAME = "google-search-console-incremental";
