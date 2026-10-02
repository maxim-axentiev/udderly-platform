import {
  GA_ADMIN_API_ALPHA,
  GA_ADMIN_API_BETA,
  GA_DATA_API_BASE,
  GA_MAX_PAGES,
  GA_MAX_RETRIES,
  GA_REPORT_PAGE_LIMIT,
  GA_REQUEST_TIMEOUT_MS,
  GA_TOKEN_URL,
} from "./google-analytics.constants";
import {
  GoogleAnalyticsApiError,
  redactSecrets,
} from "./google-analytics.errors";
import { evaluateReportQuality } from "./google-analytics.quality";
import type { GaReportDefinition } from "./google-analytics.reports";
import type {
  GaCompletedReport,
  GaReportPage,
  GoogleAnalyticsClientConfig,
  GoogleAnalyticsJson,
} from "./google-analytics.types";

export class GoogleAnalyticsClient {
  private accessToken?: string;
  private accessTokenExpiresAt = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;

  constructor(private readonly config: GoogleAnalyticsClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.nowMs = config.nowMs ?? Date.now;
  }

  get propertyId(): string {
    return this.config.propertyId.replace(/^properties\//, "");
  }

  async getMetadata(): Promise<GoogleAnalyticsJson> {
    return this.request(
      "GET",
      `${GA_DATA_API_BASE}/properties/${this.propertyId}/metadata`,
    );
  }

  async checkCompatibility(
    dimensions: string[],
    metrics: string[],
  ): Promise<GoogleAnalyticsJson> {
    return this.request(
      "POST",
      `${GA_DATA_API_BASE}/properties/${this.propertyId}:checkCompatibility`,
      {
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
      },
    );
  }

  async getProperty(): Promise<GoogleAnalyticsJson> {
    return this.request("GET", `${GA_ADMIN_API_BETA}/properties/${this.propertyId}`);
  }

  async getDataRetentionSettings(): Promise<GoogleAnalyticsJson> {
    return this.request(
      "GET",
      `${GA_ADMIN_API_BETA}/properties/${this.propertyId}/dataRetentionSettings`,
    );
  }

  async listDataStreams(): Promise<GoogleAnalyticsJson> {
    return this.request(
      "GET",
      `${GA_ADMIN_API_BETA}/properties/${this.propertyId}/dataStreams?pageSize=200`,
    );
  }

  async listCustomDimensions(): Promise<GoogleAnalyticsJson> {
    return this.request(
      "GET",
      `${GA_ADMIN_API_BETA}/properties/${this.propertyId}/customDimensions?pageSize=200`,
    );
  }

  async listCustomMetrics(): Promise<GoogleAnalyticsJson> {
    return this.request(
      "GET",
      `${GA_ADMIN_API_BETA}/properties/${this.propertyId}/customMetrics?pageSize=200`,
    );
  }

  async listKeyEvents(): Promise<GoogleAnalyticsJson> {
    return this.request(
      "GET",
      `${GA_ADMIN_API_BETA}/properties/${this.propertyId}/keyEvents?pageSize=200`,
    );
  }

  async listGoogleAdsLinks(): Promise<GoogleAnalyticsJson> {
    return this.request(
      "GET",
      `${GA_ADMIN_API_BETA}/properties/${this.propertyId}/googleAdsLinks?pageSize=200`,
    );
  }

  async getAttributionSettings(): Promise<GoogleAnalyticsJson> {
    return this.request(
      "GET",
      `${GA_ADMIN_API_ALPHA}/properties/${this.propertyId}/attributionSettings`,
    );
  }

  async getReportingIdentitySettings(): Promise<GoogleAnalyticsJson> {
    return this.request(
      "GET",
      `${GA_ADMIN_API_ALPHA}/properties/${this.propertyId}/reportingIdentitySettings`,
    );
  }

  async runFamilyReport(
    definition: GaReportDefinition,
    startDate: string,
    endDate: string,
  ): Promise<GaCompletedReport> {
    return this.runReportPaginated({
      family: definition.id,
      dimensions: definition.dimensions,
      metrics: definition.metrics,
      startDate,
      endDate,
    });
  }

  async runReportPaginated(input: {
    family: string;
    dimensions: string[];
    metrics: string[];
    startDate: string;
    endDate: string;
  }): Promise<GaCompletedReport> {
    const rows: GoogleAnalyticsJson[] = [];
    const keys = new Set<string>();
    let offset = 0;
    let requestCount = 0;
    let expectedRowCount: number | undefined;
    const limit = this.config.reportPageLimit ?? GA_REPORT_PAGE_LIMIT;
    const maxPages = this.config.maxPages ?? GA_MAX_PAGES;

    while (requestCount < maxPages) {
      requestCount += 1;
      const page = await this.runReportPage({
        dimensions: input.dimensions,
        metrics: input.metrics,
        startDate: input.startDate,
        endDate: input.endDate,
        limit,
        offset,
      });
      if (expectedRowCount === undefined) {
        expectedRowCount = page.rowCount;
      } else if (page.rowCount !== expectedRowCount) {
        throw new GoogleAnalyticsApiError(
          `Google Analytics ${input.family} rowCount changed from ${expectedRowCount} to ${page.rowCount}`,
        );
      }
      for (const row of page.rows) {
        const key = rowKey(row, input.dimensions.length);
        if (keys.has(key)) {
          throw new GoogleAnalyticsApiError(
            `Google Analytics ${input.family} returned duplicate dimension keys`,
          );
        }
        keys.add(key);
        rows.push(row);
      }
      if (rows.length > expectedRowCount) {
        throw new GoogleAnalyticsApiError(
          `Google Analytics ${input.family} accumulated more rows than rowCount`,
        );
      }
      if (page.rows.length === 0 || rows.length >= expectedRowCount) {
        if (rows.length !== expectedRowCount) {
          throw new GoogleAnalyticsApiError(
            `Google Analytics ${input.family} pagination incomplete: ${rows.length} of ${expectedRowCount}`,
          );
        }
        return {
          family: input.family,
          property: `properties/${this.propertyId}`,
          startDate: input.startDate,
          endDate: input.endDate,
          rows,
          rowCount: expectedRowCount,
          dimensionHeaders: page.dimensionHeaders,
          metricHeaders: page.metricHeaders,
          quality: page.quality,
          propertyQuota: page.propertyQuota,
          requestCount,
        };
      }
      if (page.rows.length < limit && rows.length < expectedRowCount) {
        throw new GoogleAnalyticsApiError(
          `Google Analytics ${input.family} stopped before rowCount was exhausted`,
        );
      }
      offset += page.rows.length;
    }

    throw new GoogleAnalyticsApiError(
      `Google Analytics ${input.family} exceeded ${maxPages} pages`,
    );
  }

  async runReportPage(input: {
    dimensions: string[];
    metrics: string[];
    startDate: string;
    endDate: string;
    limit: number;
    offset: number;
  }): Promise<GaReportPage> {
    const payload = await this.request(
      "POST",
      `${GA_DATA_API_BASE}/properties/${this.propertyId}:runReport`,
      {
        dimensions: input.dimensions.map((name) => ({ name })),
        metrics: input.metrics.map((name) => ({ name })),
        dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
        limit: String(input.limit),
        offset: String(input.offset),
        returnPropertyQuota: true,
      },
    );
    const dimensionHeaders = headerNames(payload.dimensionHeaders, "name");
    const metricHeaders = headerNames(payload.metricHeaders, "name");
    if (
      !headersMatch(dimensionHeaders, input.dimensions) ||
      !headersMatch(metricHeaders, input.metrics)
    ) {
      throw new GoogleAnalyticsApiError(
        "Google Analytics report headers did not match the allowlisted request",
      );
    }
    const rows = Array.isArray(payload.rows)
      ? (payload.rows as GoogleAnalyticsJson[])
      : [];
    const rowCount = Number(payload.rowCount ?? rows.length);
    if (!Number.isFinite(rowCount) || rowCount < 0) {
      throw new GoogleAnalyticsApiError("Google Analytics rowCount was malformed");
    }
    return {
      rows,
      rowCount,
      dimensionHeaders,
      metricHeaders,
      quality: evaluateReportQuality(payload),
      propertyQuota: payload.propertyQuota,
    };
  }

  private async request(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
  ): Promise<GoogleAnalyticsJson> {
    let lastError: GoogleAnalyticsApiError | undefined;
    for (let attempt = 1; attempt <= GA_MAX_RETRIES; attempt += 1) {
      try {
        return await this.send(method, url, body);
      } catch (error) {
        if (
          !(error instanceof GoogleAnalyticsApiError) ||
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
    throw lastError ?? new GoogleAnalyticsApiError(`Google Analytics ${url} failed`);
  }

  private async send(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
  ): Promise<GoogleAnalyticsJson> {
    const token = await this.accessTokenValue();
    const timeoutMs = this.config.timeoutMs ?? GA_REQUEST_TIMEOUT_MS;
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
      throw new GoogleAnalyticsApiError(
        this.safeErrorMessage(url, error),
        undefined,
        true,
      );
    }

    if (response.status === 429 || response.status === 500 || response.status === 503) {
      throw new GoogleAnalyticsApiError(
        `Google Analytics ${pathOf(url)} failed with HTTP ${response.status}`,
        response.status,
        true,
      );
    }

    if (!response.ok) {
      throw new GoogleAnalyticsApiError(
        `Google Analytics ${pathOf(url)} failed with HTTP ${response.status}${safeErrorSuffix(await readJsonSafe(response), this.secrets())}`,
        response.status,
      );
    }

    try {
      return (await response.json()) as GoogleAnalyticsJson;
    } catch {
      throw new GoogleAnalyticsApiError(
        `Google Analytics ${pathOf(url)} returned a non-JSON response`,
        response.status,
      );
    }
  }

  private async accessTokenValue(): Promise<string> {
    if (this.accessToken && this.nowMs() < this.accessTokenExpiresAt - 30_000) {
      return this.accessToken;
    }
    const response = await this.fetchImpl(GA_TOKEN_URL, {
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
      throw new GoogleAnalyticsApiError(
        `Google Analytics token refresh failed with HTTP ${response.status}`,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }
    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!payload.access_token) {
      throw new GoogleAnalyticsApiError("Google Analytics token refresh returned no access token");
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
      return `Google Analytics ${pathOf(url)} timed out`;
    }
    const raw = error instanceof Error ? error.message : "request failed";
    return redactSecrets(`Google Analytics ${pathOf(url)} failed: ${raw}`, this.secrets());
  }
}

function headerNames(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      return "";
    }
    const name = (item as Record<string, unknown>)[key];
    return typeof name === "string" ? name : "";
  });
}

function headersMatch(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((name, index) => name === expected[index])
  );
}

function rowKey(row: GoogleAnalyticsJson, dimensionCount: number): string {
  const values = Array.isArray(row.dimensionValues)
    ? (row.dimensionValues as GoogleAnalyticsJson[])
    : [];
  return values
    .slice(0, dimensionCount)
    .map((item) => String(item.value ?? ""))
    .join("\u0000");
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
  const error = (payload as GoogleAnalyticsJson).error;
  if (!error || typeof error !== "object") {
    return "";
  }
  const message = (error as GoogleAnalyticsJson).message;
  if (typeof message !== "string" || !message) {
    return "";
  }
  return `: ${redactSecrets(message.slice(0, 200), secrets)}`;
}
