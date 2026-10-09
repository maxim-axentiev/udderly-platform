export const META_ADS_IMPORT_ALREADY_RUNNING = "meta_ads_import_already_running";

export function formatMetaAdsLockError(message: string): string {
  return message === "advisory_lock_busy" ? META_ADS_IMPORT_ALREADY_RUNNING : message;
}
