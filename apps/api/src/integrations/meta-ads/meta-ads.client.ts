import {
  META_ADS_ATTRIBUTION_WINDOWS,
  META_ADS_ATTRIBUTION_WINDOW_ID,
  META_ADS_CANONICAL_ACCOUNT_ID,
  META_GRAPH_API_BASE,
  META_ADS_MAX_PAGES,
  META_ADS_MAX_RETRIES,
  META_ADS_PAGE_LIMIT,
  META_ADS_REQUEST_TIMEOUT_MS,
} from "./meta-ads.constants";
import { MetaAdsApiError, redactSecrets } from "./meta-ads.errors";
import type {
  MetaAdsClientConfig,
  MetaAdsCompletedInsights,
  MetaAdsInsightLevel,
  MetaAdsInsightRow,
  MetaAdsJson,
  MetaAdsPagedResult,
} from "./meta-ads.types";

const ACCOUNT_FIELDS =
  "id,account_id,name,currency,timezone_name,account_status";
const CAMPAIGN_FIELDS =
  "id,name,status,effective_status,objective,daily_budget,lifetime_budget";
const AD_SET_FIELDS =
  "id,campaign_id,name,status,effective_status,daily_budget,lifetime_budget";
const AD_FIELDS = "id,adset_id,campaign_id,name,status,effective_status";
const INSIGHT_FIELDS =
  "spend,impressions,clicks,reach,frequency,cpc,cpm,ctr,date_start,date_stop,campaign_id,adset_id,ad_id,account_id";

export class MetaAdsClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: MetaAdsClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    if (config.accountId !== META_ADS_CANONICAL_ACCOUNT_ID) {
      throw new Error("meta_ads_account_id_not_canonical");
    }
  }

  get accountId(): string {
    return this.config.accountId;
  }

  async getAccount(): Promise<MetaAdsJson> {
    return this.request(
      "GET",
      this.objectUrl(this.config.accountId, { fields: ACCOUNT_FIELDS }),
    );
  }

  async listCampaigns(): Promise<MetaAdsPagedResult<MetaAdsJson>> {
    return this.listCollection(`${this.config.accountId}/campaigns`, CAMPAIGN_FIELDS);
  }

  async listAdSets(): Promise<MetaAdsPagedResult<MetaAdsJson>> {
    return this.listCollection(`${this.config.accountId}/adsets`, AD_SET_FIELDS);
  }

  async listAds(): Promise<MetaAdsPagedResult<MetaAdsJson>> {
    return this.listCollection(`${this.config.accountId}/ads`, AD_FIELDS);
  }

  async listInsights(input: {
    level: MetaAdsInsightLevel;
    startDate: string;
    endDate: string;
  }): Promise<MetaAdsCompletedInsights> {
    const params: Record<string, string> = {
      fields: INSIGHT_FIELDS,
      level: input.level,
      time_increment: "1",
      time_range: JSON.stringify({ since: input.startDate, until: input.endDate }),
      action_attribution_windows: JSON.stringify([...META_ADS_ATTRIBUTION_WINDOWS]),
    };
    const page = await this.listCollection(
      `${this.config.accountId}/insights`,
      undefined,
      params,
    );
    const rows = page.items.map((item, index) =>
      parseInsightRow(item, input.level, index),
    );
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.dateStart}|${row.objectId}`;
      if (seen.has(key)) {
        throw new MetaAdsApiError(
          `Meta Ads ${input.level} insights returned duplicate grains`,
        );
      }
      seen.add(key);
    }
    return {
      level: input.level,
      accountId: this.config.accountId,
      startDate: input.startDate,
      endDate: input.endDate,
      attributionWindow: META_ADS_ATTRIBUTION_WINDOW_ID,
      rows,
      rowCount: rows.length,
      requestCount: page.requestCount,
    };
  }

  private async listCollection(
    path: string,
    fields?: string,
    extra?: Record<string, string>,
  ): Promise<MetaAdsPagedResult<MetaAdsJson>> {
    const items: MetaAdsJson[] = [];
    const seen = new Set<string>();
    let after: string | undefined;
    let requestCount = 0;
    const pageLimit = this.config.pageLimit ?? META_ADS_PAGE_LIMIT;
    const maxPages = this.config.maxPages ?? META_ADS_MAX_PAGES;

    while (requestCount < maxPages) {
      requestCount += 1;
      const query: Record<string, string> = {
        limit: String(pageLimit),
        ...(extra ?? {}),
      };
      if (fields) {
        query.fields = fields;
      }
      if (after) {
        query.after = after;
      }
      const payload = await this.request("GET", this.objectUrl(path, query));
      const data = Array.isArray(payload.data) ? payload.data : [];
      for (const raw of data) {
        if (!raw || typeof raw !== "object") {
          throw new MetaAdsApiError("Meta Ads collection row was malformed");
        }
        const record = raw as MetaAdsJson;
        const id = typeof record.id === "string" ? record.id : undefined;
        if (id) {
          if (seen.has(id)) {
            throw new MetaAdsApiError("Meta Ads collection returned duplicate ids");
          }
          seen.add(id);
        }
        items.push(record);
      }
      const nextAfter = pagingAfter(payload);
      if (!nextAfter || data.length === 0) {
        return { items, requestCount };
      }
      after = nextAfter;
    }

    throw new MetaAdsApiError(
      `Meta Ads ${path} exceeded ${maxPages} pages; refusing to truncate`,
    );
  }

  private objectUrl(path: string, query: Record<string, string>): string {
    const params = new URLSearchParams(query);
    return `${META_GRAPH_API_BASE}/${path}?${params.toString()}`;
  }

  private async request(method: "GET", url: string): Promise<MetaAdsJson> {
    if (method !== "GET") {
      throw new MetaAdsApiError("Meta Ads client is read-only");
    }
    let lastError: MetaAdsApiError | undefined;
    for (let attempt = 1; attempt <= META_ADS_MAX_RETRIES; attempt += 1) {
      try {
        return await this.send(url);
      } catch (error) {
        if (!(error instanceof MetaAdsApiError) || !error.retryable) {
          throw error;
        }
        lastError = error;
        const backoff =
          this.config.retryBackoffMs ?? Math.min(16_000, 1000 * 2 ** (attempt - 1));
        if (backoff > 0) {
          await delay(backoff);
        }
      }
    }
    throw lastError ?? new MetaAdsApiError(`Meta Ads ${url} failed`);
  }

  private async send(url: string): Promise<MetaAdsJson> {
    const timeoutMs = this.config.timeoutMs ?? META_ADS_REQUEST_TIMEOUT_MS;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.accessToken}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new MetaAdsApiError(this.safeErrorMessage(url, error), undefined, true);
    }

    if (response.status === 429 || response.status === 500 || response.status === 503) {
      throw new MetaAdsApiError(
        `Meta Ads ${pathOf(url)} failed with HTTP ${response.status}`,
        response.status,
        true,
      );
    }

    if (!response.ok) {
      throw new MetaAdsApiError(
        `Meta Ads ${pathOf(url)} failed with HTTP ${response.status}${safeErrorSuffix(await readJsonSafe(response), this.secrets())}`,
        response.status,
      );
    }

    if (response.status === 204) {
      return {};
    }

    try {
      return (await response.json()) as MetaAdsJson;
    } catch {
      throw new MetaAdsApiError(
        `Meta Ads ${pathOf(url)} returned a non-JSON response`,
        response.status,
      );
    }
  }

  private secrets(): string[] {
    return [this.config.accessToken];
  }

  private safeErrorMessage(url: string, error: unknown): string {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return `Meta Ads ${pathOf(url)} timed out`;
    }
    const raw = error instanceof Error ? error.message : String(error);
    return redactSecrets(`Meta Ads ${pathOf(url)} failed: ${raw}`, this.secrets());
  }
}

function parseInsightRow(
  row: MetaAdsJson,
  level: MetaAdsInsightLevel,
  index: number,
): MetaAdsInsightRow {
  const dateStart = requiredString(row.date_start, "date_start", index);
  const dateStop = requiredString(row.date_stop, "date_stop", index);
  const objectId = objectIdForLevel(row, level, index);
  return {
    dateStart,
    dateStop,
    objectId,
    campaignId: optionalString(row.campaign_id),
    adsetId: optionalString(row.adset_id),
    adId: optionalString(row.ad_id),
    spend: requiredString(row.spend, "spend", index),
    impressions: requiredString(row.impressions, "impressions", index),
    clicks: requiredString(row.clicks, "clicks", index),
    reach: optionalString(row.reach),
    frequency: optionalString(row.frequency),
    cpc: optionalString(row.cpc),
    cpm: optionalString(row.cpm),
    ctr: optionalString(row.ctr),
  };
}

function objectIdForLevel(
  row: MetaAdsJson,
  level: MetaAdsInsightLevel,
  index: number,
): string {
  if (level === "account") {
    return requiredString(row.account_id ?? row.id, "account_id", index);
  }
  if (level === "campaign") {
    return requiredString(row.campaign_id ?? row.id, "campaign_id", index);
  }
  if (level === "adset") {
    return requiredString(row.adset_id ?? row.id, "adset_id", index);
  }
  return requiredString(row.ad_id ?? row.id, "ad_id", index);
}

function requiredString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MetaAdsApiError(`Meta Ads insights row ${index} ${field} was malformed`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pagingAfter(payload: MetaAdsJson): string | undefined {
  const paging = payload.paging;
  if (!paging || typeof paging !== "object") {
    return undefined;
  }
  const cursors = (paging as MetaAdsJson).cursors;
  const after =
    cursors && typeof cursors === "object"
      ? (cursors as MetaAdsJson).after
      : undefined;
  const next = (paging as MetaAdsJson).next;
  if (typeof next === "string" && next.length > 0) {
    if (typeof after !== "string" || after.length === 0) {
      throw new MetaAdsApiError(
        "Meta Ads paging.next without cursor; refusing to truncate",
      );
    }
  }
  return typeof after === "string" && after.length > 0 ? after : undefined;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "request";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function safeErrorSuffix(payload: unknown, secrets: string[]): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const error = (payload as MetaAdsJson).error;
  if (!error || typeof error !== "object") {
    return "";
  }
  const message = (error as MetaAdsJson).message;
  if (typeof message !== "string" || !message) {
    return "";
  }
  return `: ${redactSecrets(message.slice(0, 200), secrets)}`;
}
