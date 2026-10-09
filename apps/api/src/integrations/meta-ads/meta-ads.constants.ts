export const META_ADS_PROVIDER = "meta_ads";

export const META_ADS_ACCOUNT_ENTITY = "account";
export const META_ADS_CAMPAIGN_ENTITY = "campaign";
export const META_ADS_AD_SET_ENTITY = "ad_set";
export const META_ADS_AD_ENTITY = "ad";
export const META_ADS_INSIGHT_ENTITY = "insight_report";

export const META_GRAPH_VERSION = "v26.0";
export const META_GRAPH_API_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export const META_ADS_CANONICAL_ACCOUNT_ID = "act_1818645281666685";
/** Documented app id only. Not an env requirement and never used as a token. */
export const META_ADS_DOCUMENTED_APP_ID = "4481084798772969";
export const META_ADS_CANONICAL_CURRENCY = "CAD";
export const META_ADS_REPORTING_TIME_ZONE = "America/Toronto";

/**
 * Pinned Insights attribution windows. Stored on every daily grain and in
 * snapshot external ids. Do not mix windows in one canonical row.
 */
export const META_ADS_ATTRIBUTION_WINDOWS = ["7d_click", "1d_view"] as const;
export const META_ADS_ATTRIBUTION_WINDOW_ID = "7d_click,1d_view";

export const META_ADS_MAX_RETRIES = 4;
export const META_ADS_REQUEST_TIMEOUT_MS = 60_000;
export const META_ADS_PAGE_LIMIT = 100;
export const META_ADS_MAX_PAGES = 50;

/**
 * Discrete completed Toronto-calendar offsets. Not a contiguous range.
 * 1–3 catch near-term Insights revisions; 7 matches pinned 7d_click;
 * 14 and 28 catch later Meta revisions without becoming a backfill.
 */
export const META_ADS_INCREMENTAL_DAY_OFFSETS = [1, 2, 3, 7, 14, 28] as const;

/** Shared by bounded import and incremental so they cannot overlap. */
export const META_ADS_IMPORT_LOCK_NAME = "meta-ads-import";
export const META_ADS_INCREMENTAL_LOCK_NAME = META_ADS_IMPORT_LOCK_NAME;
