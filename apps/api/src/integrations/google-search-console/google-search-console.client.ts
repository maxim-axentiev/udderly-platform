import {
  GSC_API_BASE,
  GSC_CANONICAL_SITE_URL,
  GSC_DATA_STATE,
  GSC_MAX_PAGES,
  GSC_MAX_RETRIES,
  GSC_REPORT_ROW_LIMIT,
  GSC_REQUEST_TIMEOUT_MS,
  GSC_SEARCH_TYPE,
  GSC_TOKEN_URL,
} from "./google-search-console.constants";
import {
  GoogleSearchConsoleApiError,
  redactSecrets,
} from "./google-search-console.errors";
import { gscDatesInclusive } from "./google-search-console.range";
import type { GscReportDefinition } from "./google-search-console.reports";
import type {
  GscCompletedReport,
  GscReportRow,
  GoogleSearchConsoleClientConfig,
  GoogleSearchConsoleJson,
} from "./google-search-console.types";

export class GoogleSearchConsoleClient {
  private accessToken?: string;
  private accessTokenExpiresAt = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;

  constructor(private readonly config: GoogleSearchConsoleClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.nowMs = config.nowMs ?? Date.now;
    if (config.siteUrl !== GSC_CANONICAL_SITE_URL) {
      throw new Error("gsc_site_url_not_canonical");
    }
  }

  get siteUrl(): string {
    return this.config.siteUrl;
  }

  async getSite(): Promise<GoogleSearchConsoleJson> {
    return this.request("GET", this.siteResourceUrl());
  }

  async runFamilyReport(
    definition: GscReportDefinition,
    startDate: string,
    endDate: string,
  ): Promise<GscCompletedReport> {
    if (definition.id !== "search_appearance") {
      return this.runSearchAnalyticsPaginated({
        family: definition.id,
        dimensions: definition.dimensions,
        startDate,
        endDate,
      });
    }
    const rows: GscReportRow[] = [];
    let requestCount = 0;
    for (const date of gscDatesInclusive(startDate, endDate)) {
      const day = await this.runSearchAnalyticsPaginated({
        family: definition.id,
        dimensions: definition.dimensions,
        startDate: date,
        endDate: date,
      });
      requestCount += day.requestCount;
      for (const row of day.rows) {
        rows.push({ ...row, gscDate: date });
      }
    }
    return {
      family: definition.id,
      siteUrl: this.siteUrl,
      startDate,
      endDate,
      dataState: GSC_DATA_STATE,
      searchType: GSC_SEARCH_TYPE,
      dimensions: definition.dimensions,
      rows,
      rowCount: rows.length,
      requestCount,
    };
  }

  async runSearchAnalyticsPaginated(input: {
    family: string;
    dimensions: string[];
    startDate: string;
    endDate: string;
  }): Promise<GscCompletedReport> {
    const rows: GscReportRow[] = [];
    const seen = new Set<string>();
    let startRow = 0;
    let requestCount = 0;
    const rowLimit = this.config.reportRowLimit ?? GSC_REPORT_ROW_LIMIT;
    const maxPages = this.config.maxPages ?? GSC_MAX_PAGES;

    while (requestCount < maxPages) {
      requestCount += 1;
      const pageRows = await this.searchAnalyticsPage({
        dimensions: input.dimensions,
        startDate: input.startDate,
        endDate: input.endDate,
        rowLimit,
        startRow,
      });
      for (const row of pageRows) {
        const key = row.keys.join("\u0000");
        if (seen.has(key)) {
          throw new GoogleSearchConsoleApiError(
            `Google Search Console ${input.family} returned duplicate dimension keys`,
          );
        }
        seen.add(key);
        rows.push(row);
      }
      if (pageRows.length < rowLimit) {
        return this.completed(input, rows, requestCount);
      }
      startRow += pageRows.length;
    }

    throw new GoogleSearchConsoleApiError(
      `Google Search Console ${input.family} exceeded ${maxPages} pages; refusing to truncate`,
    );
  }

  private completed(
    input: {
      family: string;
      dimensions: string[];
      startDate: string;
      endDate: string;
    },
    rows: GscReportRow[],
    requestCount: number,
  ): GscCompletedReport {
    return {
      family: input.family,
      siteUrl: this.siteUrl,
      startDate: input.startDate,
      endDate: input.endDate,
      dataState: GSC_DATA_STATE,
      searchType: GSC_SEARCH_TYPE,
      dimensions: input.dimensions,
      rows,
      rowCount: rows.length,
      requestCount,
    };
  }

  private async searchAnalyticsPage(input: {
    dimensions: string[];
    startDate: string;
    endDate: string;
    rowLimit: number;
    startRow: number;
  }): Promise<GscReportRow[]> {
    const payload = await this.request(
      "POST",
      `${this.siteResourceUrl()}/searchAnalytics/query`,
      {
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
        searchType: GSC_SEARCH_TYPE,
        dataState: GSC_DATA_STATE,
        rowLimit: input.rowLimit,
        startRow: input.startRow,
        aggregationType: "auto",
      },
    );
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    return rows.map((row, index) => parseReportRow(row, input.dimensions.length, index));
  }

  private siteResourceUrl(): string {
    return `${GSC_API_BASE}/sites/${encodeURIComponent(this.siteUrl)}`;
  }

  private async request(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
  ): Promise<GoogleSearchConsoleJson> {
    let lastError: GoogleSearchConsoleApiError | undefined;
    for (let attempt = 1; attempt <= GSC_MAX_RETRIES; attempt += 1) {
      try {
        return await this.send(method, url, body);
      } catch (error) {
        if (
          !(error instanceof GoogleSearchConsoleApiError) ||
          !error.retryable
        ) {
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
    throw lastError ?? new GoogleSearchConsoleApiError(`Google Search Console ${url} failed`);
  }

  private async send(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
  ): Promise<GoogleSearchConsoleJson> {
    const token = await this.accessTokenValue();
    const timeoutMs = this.config.timeoutMs ?? GSC_REQUEST_TIMEOUT_MS;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new GoogleSearchConsoleApiError(
        this.safeErrorMessage(url, error),
        undefined,
        true,
      );
    }

    if (response.status === 429 || response.status === 500 || response.status === 503) {
      throw new GoogleSearchConsoleApiError(
        `Google Search Console ${pathOf(url)} failed with HTTP ${response.status}`,
        response.status,
        true,
      );
    }

    if (!response.ok) {
      throw new GoogleSearchConsoleApiError(
        `Google Search Console ${pathOf(url)} failed with HTTP ${response.status}${safeErrorSuffix(await readJsonSafe(response), this.secrets())}`,
        response.status,
      );
    }

    if (response.status === 204) {
      return {};
    }

    try {
      return (await response.json()) as GoogleSearchConsoleJson;
    } catch {
      throw new GoogleSearchConsoleApiError(
        `Google Search Console ${pathOf(url)} returned a non-JSON response`,
        response.status,
      );
    }
  }

  private async accessTokenValue(): Promise<string> {
    if (this.accessToken && this.nowMs() < this.accessTokenExpiresAt - 30_000) {
      return this.accessToken;
    }
    const response = await this.fetchImpl(GSC_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) {
      throw new GoogleSearchConsoleApiError(
        `Google Search Console token refresh failed with HTTP ${response.status}`,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }
    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!payload.access_token) {
      throw new GoogleSearchConsoleApiError(
        "Google Search Console token refresh returned no access token",
      );
    }
    this.accessToken = payload.access_token;
    const expiresIn = Number(payload.expires_in ?? 3600);
    this.accessTokenExpiresAt = this.nowMs() + expiresIn * 1000;
    return this.accessToken;
  }

  private secrets(): string[] {
    return [
      this.config.clientSecret,
      this.config.refreshToken,
      this.accessToken ?? "",
    ];
  }

  private safeErrorMessage(url: string, error: unknown): string {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return `Google Search Console ${pathOf(url)} timed out`;
    }
    const raw = error instanceof Error ? error.message : String(error);
    return redactSecrets(`Google Search Console ${pathOf(url)} failed: ${raw}`, this.secrets());
  }
}

function parseReportRow(
  row: unknown,
  dimensionCount: number,
  index: number,
): GscReportRow {
  if (!row || typeof row !== "object") {
    throw new GoogleSearchConsoleApiError(
      `Google Search Console row ${index} was malformed`,
    );
  }
  const record = row as GoogleSearchConsoleJson;
  const keys = Array.isArray(record.keys) ? record.keys : [];
  if (keys.length !== dimensionCount || keys.some((item) => typeof item !== "string")) {
    throw new GoogleSearchConsoleApiError(
      `Google Search Console row ${index} keys did not match dimensions`,
    );
  }
  return {
    keys: keys as string[],
    clicks: requiredNumber(record.clicks, "clicks", index),
    impressions: requiredNumber(record.impressions, "impressions", index),
    ctr: requiredNumber(record.ctr, "ctr", index),
    position: requiredNumber(record.position, "position", index),
  };
}

function requiredNumber(value: unknown, field: string, index: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new GoogleSearchConsoleApiError(
      `Google Search Console row ${index} ${field} was malformed`,
    );
  }
  return number;
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
  const error = (payload as GoogleSearchConsoleJson).error;
  if (!error || typeof error !== "object") {
    return "";
  }
  const message = (error as GoogleSearchConsoleJson).message;
  if (typeof message !== "string" || !message) {
    return "";
  }
  return `: ${redactSecrets(message.slice(0, 200), secrets)}`;
}
