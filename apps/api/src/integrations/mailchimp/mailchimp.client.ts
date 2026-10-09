import {
  MAILCHIMP_API_VERSION,
  MAILCHIMP_FORBIDDEN_PATH_FRAGMENTS,
  MAILCHIMP_MAX_PAGES,
  MAILCHIMP_MAX_RETRIES,
  MAILCHIMP_PAGE_COUNT,
  MAILCHIMP_REQUEST_TIMEOUT_MS,
} from "./mailchimp.constants";
import { MailchimpApiError, redactSecrets } from "./mailchimp.errors";
import type {
  MailchimpClientConfig,
  MailchimpJson,
  MailchimpPagedResult,
} from "./mailchimp.types";

const LIST_FIELDS =
  "lists.id,lists.name,lists.stats,total_items";
const CAMPAIGN_FIELDS =
  "campaigns.id,campaigns.type,campaigns.status,campaigns.send_time,campaigns.settings.title,campaigns.settings.subject_line,campaigns.settings.preview_text,campaigns.recipients.list_id,campaigns.recipients.list_name,campaigns.recipients.recipient_count,campaigns.tracking.google_analytics,total_items";
const REPORT_FIELDS =
  "reports.id,reports.campaign_title,reports.type,reports.list_id,reports.list_name,reports.subject_line,reports.preview_text,reports.emails_sent,reports.abuse_reports,reports.unsubscribed,reports.send_time,reports.bounces,reports.forwards,reports.opens,reports.clicks,total_items";
const CLICK_FIELDS =
  "urls_clicked.id,urls_clicked.url,urls_clicked.total_clicks,urls_clicked.unique_clicks,urls_clicked.click_percentage,urls_clicked.unique_click_percentage,urls_clicked.last_click,total_items";
const GROWTH_FIELDS =
  "history.list_id,history.month,history.subscribed,history.unsubscribed,history.cleaned,history.deleted,history.pending,history.reconfirm,total_items";
const ACTIVITY_FIELDS =
  "activity.day,activity.emails_sent,activity.unique_opens,activity.recipient_clicks,activity.hard_bounce,activity.soft_bounce,activity.subs,activity.unsubs,activity.other_adds,activity.other_removes,total_items";

export function mailchimpDataCenter(apiKey: string): string {
  const dash = apiKey.lastIndexOf("-");
  const dc = dash >= 0 ? apiKey.slice(dash + 1) : "";
  if (!/^[a-z]{1,4}\d{1,3}$/i.test(dc)) {
    throw new Error("mailchimp_data_center_unreadable");
  }
  return dc.toLowerCase();
}

export function assertMailchimpPathAllowed(path: string): void {
  const normalized = path.toLowerCase();
  for (const fragment of MAILCHIMP_FORBIDDEN_PATH_FRAGMENTS) {
    if (normalized.includes(fragment)) {
      throw new MailchimpApiError("mailchimp_forbidden_pii_endpoint");
    }
  }
}

export class MailchimpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly dataCenter: string;
  readonly apiBase: string;

  constructor(private readonly config: MailchimpClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.dataCenter = mailchimpDataCenter(config.apiKey);
    this.apiBase = `https://${this.dataCenter}.api.mailchimp.com/${MAILCHIMP_API_VERSION}`;
  }

  async ping(): Promise<MailchimpJson> {
    return this.request("GET", this.objectUrl("ping"));
  }

  async getAccount(): Promise<MailchimpJson> {
    return this.request(
      "GET",
      this.objectUrl("", {
        fields: "account_id,account_name,account_timezone",
      }),
    );
  }

  async listAudiences(): Promise<MailchimpPagedResult<MailchimpJson>> {
    return this.listCollection("lists", "lists", LIST_FIELDS);
  }

  async listGrowthHistory(listId: string): Promise<MailchimpPagedResult<MailchimpJson>> {
    return this.listCollection(
      `lists/${encodeURIComponent(listId)}/growth-history`,
      "history",
      GROWTH_FIELDS,
    );
  }

  async listActivity(listId: string): Promise<MailchimpPagedResult<MailchimpJson>> {
    return this.listCollection(
      `lists/${encodeURIComponent(listId)}/activity`,
      "activity",
      ACTIVITY_FIELDS,
    );
  }

  async listSentCampaigns(): Promise<MailchimpPagedResult<MailchimpJson>> {
    return this.listCollection("campaigns", "campaigns", CAMPAIGN_FIELDS, {
      status: "sent",
    });
  }

  async listReports(): Promise<MailchimpPagedResult<MailchimpJson>> {
    return this.listCollection("reports", "reports", REPORT_FIELDS);
  }

  async listClickDetails(
    campaignId: string,
  ): Promise<MailchimpPagedResult<MailchimpJson>> {
    return this.listCollection(
      `reports/${encodeURIComponent(campaignId)}/click-details`,
      "urls_clicked",
      CLICK_FIELDS,
    );
  }

  private async listCollection(
    path: string,
    collectionKey: string,
    fields: string,
    extra?: Record<string, string>,
  ): Promise<MailchimpPagedResult<MailchimpJson>> {
    const items: MailchimpJson[] = [];
    const seen = new Set<string>();
    let offset = 0;
    let requestCount = 0;
    const pageCount = this.config.pageCount ?? MAILCHIMP_PAGE_COUNT;
    const maxPages = this.config.maxPages ?? MAILCHIMP_MAX_PAGES;
    let totalItems: number | undefined;

    while (requestCount < maxPages) {
      requestCount += 1;
      const payload = await this.request(
        "GET",
        this.objectUrl(path, {
          count: String(pageCount),
          offset: String(offset),
          fields,
          ...(extra ?? {}),
        }),
      );
      const page = Array.isArray(payload[collectionKey])
        ? (payload[collectionKey] as MailchimpJson[])
        : [];
      if (typeof payload.total_items === "number") {
        totalItems = payload.total_items;
      }
      for (const raw of page) {
        if (!raw || typeof raw !== "object") {
          throw new MailchimpApiError("Mailchimp collection row was malformed");
        }
        const id = typeof raw.id === "string" ? raw.id : undefined;
        const grain =
          id ??
          (typeof raw.month === "string"
            ? `month:${raw.month}`
            : typeof raw.day === "string"
              ? `day:${raw.day}`
              : undefined);
        if (grain) {
          if (seen.has(grain)) {
            throw new MailchimpApiError("Mailchimp collection returned duplicate ids");
          }
          seen.add(grain);
        }
        items.push(raw);
      }
      offset += page.length;
      if (page.length === 0) {
        break;
      }
      if (totalItems === undefined) {
        throw new MailchimpApiError(
          `Mailchimp ${path} omitted total_items; refusing to truncate`,
        );
      }
      if (offset >= totalItems) {
        return { items, totalItems, requestCount };
      }
      if (page.length < pageCount) {
        throw new MailchimpApiError(
          `Mailchimp ${path} returned a short page before total_items; refusing to truncate`,
        );
      }
    }

    if (totalItems !== undefined && offset >= totalItems) {
      return { items, totalItems, requestCount };
    }
    throw new MailchimpApiError(
      `Mailchimp ${path} exceeded ${maxPages} pages; refusing to truncate`,
    );
  }

  private objectUrl(path: string, query: Record<string, string> = {}): string {
    assertMailchimpPathAllowed(`/${path}`);
    const params = new URLSearchParams(query);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const prefix = path ? `/${path}` : "";
    return `${this.apiBase}${prefix}${suffix}`;
  }

  private async request(method: "GET", url: string): Promise<MailchimpJson> {
    if (method !== "GET") {
      throw new MailchimpApiError("Mailchimp client is read-only");
    }
    let lastError: MailchimpApiError | undefined;
    for (let attempt = 1; attempt <= MAILCHIMP_MAX_RETRIES; attempt += 1) {
      try {
        return await this.send(url);
      } catch (error) {
        if (!(error instanceof MailchimpApiError) || !error.retryable) {
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
    throw lastError ?? new MailchimpApiError("Mailchimp request failed");
  }

  private async send(url: string): Promise<MailchimpJson> {
    const timeoutMs = this.config.timeoutMs ?? MAILCHIMP_REQUEST_TIMEOUT_MS;
    const basic = Buffer.from(`udderly:${this.config.apiKey}`, "utf8").toString(
      "base64",
    );
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${basic}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new MailchimpApiError(this.safeErrorMessage(url, error), undefined, true);
    }

    if (response.status === 429 || response.status === 500 || response.status === 503) {
      throw new MailchimpApiError(
        `Mailchimp ${pathOf(url)} failed with HTTP ${response.status}`,
        response.status,
        true,
      );
    }
    if (!response.ok) {
      throw new MailchimpApiError(
        `Mailchimp ${pathOf(url)} failed with HTTP ${response.status}${safeErrorSuffix(await readJsonSafe(response), this.secrets())}`,
        response.status,
      );
    }
    try {
      return (await response.json()) as MailchimpJson;
    } catch {
      throw new MailchimpApiError(
        `Mailchimp ${pathOf(url)} returned a non-JSON response`,
        response.status,
      );
    }
  }

  private secrets(): string[] {
    return [this.config.apiKey];
  }

  private safeErrorMessage(url: string, error: unknown): string {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return `Mailchimp ${pathOf(url)} timed out`;
    }
    const raw = error instanceof Error ? error.message : String(error);
    return redactSecrets(`Mailchimp ${pathOf(url)} failed: ${raw}`, this.secrets());
  }
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
  const error = (payload as MailchimpJson).detail ?? (payload as MailchimpJson).title;
  if (typeof error !== "string" || !error) {
    return "";
  }
  return `: ${redactSecrets(error.slice(0, 200), secrets)}`;
}
