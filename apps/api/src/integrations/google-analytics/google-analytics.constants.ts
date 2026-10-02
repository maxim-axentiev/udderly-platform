export const GOOGLE_ANALYTICS_PROVIDER = "google_analytics";

export const GA_PROPERTY_ENTITY = "property";
export const GA_STREAM_ENTITY = "data_stream";
export const GA_RETENTION_ENTITY = "data_retention";
export const GA_KEY_EVENT_ENTITY = "key_event";
export const GA_ATTRIBUTION_ENTITY = "attribution_settings";
export const GA_IDENTITY_ENTITY = "reporting_identity";
export const GA_ADS_LINK_ENTITY = "google_ads_link";
export const GA_CUSTOM_DIMENSION_ENTITY = "custom_dimension";
export const GA_CUSTOM_METRIC_ENTITY = "custom_metric";
export const GA_REPORT_ENTITY = "report";

export const GA_DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta";
export const GA_ADMIN_API_BETA = "https://analyticsadmin.googleapis.com/v1beta";
export const GA_ADMIN_API_ALPHA =
  "https://analyticsadmin.googleapis.com/v1alpha";
export const GA_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GA_READONLY_SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly";

export const GA_MAX_RETRIES = 4;
export const GA_REQUEST_TIMEOUT_MS = 60_000;
export const GA_REPORT_PAGE_LIMIT = 100_000;
export const GA_MAX_PAGES = 50;
export const GA_EARLIEST_USEFUL_DATE = "2022-04-13";

/** Completed farm-day offsets behind America/Toronto today. Not a contiguous range. */
export const GA_INCREMENTAL_DAY_OFFSETS = [1, 3, 7, 14] as const;

export const GA_INCREMENTAL_LOCK_NAME = "google-analytics-incremental";

export const FORBIDDEN_CUSTOM_DIMENSION_NAMES = [
  "email_address",
  "tel_number",
  "wp_user_id",
  "author",
  "customEvent:email_address",
  "customEvent:tel_number",
  "customEvent:wp_user_id",
  "customEvent:author",
] as const;

export const FORBIDDEN_DIMENSION_SUBSTRINGS = [
  "email",
  "tel_number",
  "phone",
  "wp_user_id",
  "user_id",
  "clientId",
  "client_id",
] as const;
