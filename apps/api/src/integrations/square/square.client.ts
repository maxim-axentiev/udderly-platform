import {
  SQUARE_API_BASE_URL,
  SQUARE_API_VERSION,
  SQUARE_CUSTOMERS_PAGE_LIMIT,
  SQUARE_MAX_PAGES,
  SQUARE_MAX_RETRIES,
  SQUARE_ORDERS_PAGE_LIMIT,
  SQUARE_PAGE_DELAY_MS,
  SQUARE_PAYMENTS_PAGE_LIMIT,
  SQUARE_REFUNDS_PAGE_LIMIT,
  SQUARE_REQUEST_TIMEOUT_MS,
} from "./square.constants";
import { redactSecrets, SquareApiError } from "./square.errors";
import type {
  SquareClientConfig,
  SquareJson,
  SquareUtcRange,
} from "./square.types";

export class SquareClient {
  private readonly accessToken: string;
  private readonly locationId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: SquareClientConfig) {
    this.accessToken = config.accessToken;
    this.locationId = config.locationId;
    this.baseUrl = (config.baseUrl ?? SQUARE_API_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? SQUARE_REQUEST_TIMEOUT_MS;
  }

  get configuredLocationId(): string {
    return this.locationId;
  }

  async listLocations(): Promise<Record<string, unknown>[]> {
    const payload = await this.request("GET", "/v2/locations");
    return objectsFrom(payload, "locations");
  }

  async searchOrders(
    range: SquareUtcRange,
    options: { dateField?: "created_at" | "updated_at" | "closed_at" } = {},
  ): Promise<Record<string, unknown>[]> {
    const dateField = options.dateField ?? "created_at";
    return this.paginatePost(
      "/v2/orders/search",
      "orders",
      {
        location_ids: [this.locationId],
        query: {
          filter: {
            date_time_filter: {
              [dateField]: {
                start_at: range.startAt,
                end_at: range.endAt,
              },
            },
          },
          sort: {
            sort_field: dateField === "created_at" ? "CREATED_AT" : "UPDATED_AT",
            sort_order: "DESC",
          },
        },
        limit: SQUARE_ORDERS_PAGE_LIMIT,
      },
    );
  }

  async listPayments(range: SquareUtcRange): Promise<Record<string, unknown>[]> {
    return this.paginateGet("/v2/payments", "payments", {
      begin_time: range.startAt,
      end_time: range.endAt,
      location_id: this.locationId,
      limit: String(SQUARE_PAYMENTS_PAGE_LIMIT),
    });
  }

  async listRefunds(range: SquareUtcRange): Promise<Record<string, unknown>[]> {
    return this.paginateGet("/v2/refunds", "refunds", {
      begin_time: range.startAt,
      end_time: range.endAt,
      location_id: this.locationId,
      limit: String(SQUARE_REFUNDS_PAGE_LIMIT),
    });
  }

  async searchCustomers(): Promise<{
    customers: Record<string, unknown>[];
    reportedCount?: number;
  }> {
    let reportedCount: number | undefined;
    const customers = await this.paginatePost(
      "/v2/customers/search",
      "customers",
      {
        limit: SQUARE_CUSTOMERS_PAGE_LIMIT,
        count: true,
        query: {
          sort: {
            field: "CREATED_AT",
            order: "ASC",
          },
        },
      },
      (payload) => {
        if (reportedCount === undefined) {
          reportedCount = numberField(payload, "count");
        }
      },
    );

    return { customers, reportedCount };
  }

  async listCatalog(types: string[]): Promise<Record<string, unknown>[]> {
    return this.paginateGet("/v2/catalog/list", "objects", {
      types: types.join(","),
    });
  }

  async batchRetrieveCatalogObjects(input: {
    objectIds: string[];
    catalogVersion: number;
    includeDeletedObjects?: boolean;
    includeRelatedObjects?: boolean;
  }): Promise<{
    objects: Record<string, unknown>[];
    relatedObjects: Record<string, unknown>[];
  }> {
    const objects: Record<string, unknown>[] = [];
    const relatedObjects: Record<string, unknown>[] = [];
    const uniqueIds = [...new Set(input.objectIds.filter((id) => id.length > 0))];
    for (let index = 0; index < uniqueIds.length; index += 1000) {
      const chunk = uniqueIds.slice(index, index + 1000);
      const payload = await this.request("POST", "/v2/catalog/batch-retrieve", {
        body: {
          object_ids: chunk,
          catalog_version: input.catalogVersion,
          include_deleted_objects: input.includeDeletedObjects !== false,
          include_related_objects: input.includeRelatedObjects !== false,
        },
      });
      objects.push(...objectsFrom(payload, "objects"));
      relatedObjects.push(...objectsFrom(payload, "related_objects"));
    }
    return { objects, relatedObjects };
  }

  async listCustomerGroups(): Promise<Record<string, unknown>[]> {
    return this.paginateGet("/v2/customers/groups", "groups", {});
  }

  async listCustomerSegments(): Promise<Record<string, unknown>[]> {
    return this.paginateGet("/v2/customers/segments", "segments", {});
  }

  async listCustomerCustomAttributeDefinitions(): Promise<
    Record<string, unknown>[]
  > {
    return this.paginateGet(
      "/v2/customers/custom-attribute-definitions",
      "custom_attribute_definitions",
      {},
    );
  }

  private async paginateGet(
    path: string,
    listKey: string,
    query: Record<string, string>,
  ): Promise<Record<string, unknown>[]> {
    const collected: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    let pages = 0;

    while (pages < SQUARE_MAX_PAGES) {
      pages += 1;
      const payload = await this.request("GET", path, {
        query: cursor ? { ...query, cursor } : query,
      });
      collected.push(...objectsFrom(payload, listKey));
      cursor = stringField(payload, "cursor");
      if (!cursor) {
        break;
      }
      await delay(SQUARE_PAGE_DELAY_MS);
    }

    if (cursor) {
      throw new SquareApiError(
        `Square ${path} exceeded ${SQUARE_MAX_PAGES} pages`,
      );
    }

    return collected;
  }

  private async paginatePost(
    path: string,
    listKey: string,
    body: Record<string, unknown>,
    onPage?: (payload: SquareJson) => void,
  ): Promise<Record<string, unknown>[]> {
    const collected: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    let pages = 0;

    while (pages < SQUARE_MAX_PAGES) {
      pages += 1;
      const payload = await this.request("POST", path, {
        body: cursor ? { ...body, cursor } : body,
      });
      onPage?.(payload);
      collected.push(...objectsFrom(payload, listKey));
      cursor = stringField(payload, "cursor");
      if (!cursor) {
        break;
      }
      await delay(SQUARE_PAGE_DELAY_MS);
    }

    if (cursor) {
      throw new SquareApiError(
        `Square ${path} exceeded ${SQUARE_MAX_PAGES} pages`,
      );
    }

    return collected;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    options: {
      query?: Record<string, string>;
      body?: unknown;
    } = {},
  ): Promise<SquareJson> {
    let lastError: SquareApiError | undefined;

    for (let attempt = 1; attempt <= SQUARE_MAX_RETRIES; attempt += 1) {
      try {
        return await this.send(method, path, options);
      } catch (error) {
        if (!(error instanceof SquareApiError) || !error.retryable) {
          throw error;
        }

        lastError = error;
        const waitMs = Math.min(16_000, 1000 * 2 ** (attempt - 1));
        await delay(waitMs);
      }
    }

    throw lastError ?? new SquareApiError(`Square ${path} failed`);
  }

  private async send(
    method: "GET" | "POST",
    path: string,
    options: {
      query?: Record<string, string>;
      body?: unknown;
    },
  ): Promise<SquareJson> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          "Square-Version": SQUARE_API_VERSION,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new SquareApiError(this.safeErrorMessage(path, error), undefined, true);
    }

    if (response.status === 429) {
      throw new SquareApiError(
        `Square ${path} rate limited (HTTP 429)`,
        429,
        true,
      );
    }

    if (!response.ok) {
      throw new SquareApiError(
        `Square ${path} failed with HTTP ${response.status}${safeErrorSuffix(await readJsonSafe(response))}`,
        response.status,
      );
    }

    try {
      return (await response.json()) as SquareJson;
    } catch {
      throw new SquareApiError(
        `Square ${path} returned a non-JSON response`,
        response.status,
      );
    }
  }

  private safeErrorMessage(path: string, error: unknown): string {
    if (error instanceof Error && error.name === "TimeoutError") {
      return `Square ${path} timed out`;
    }

    if (error instanceof Error && error.name === "AbortError") {
      return `Square ${path} timed out`;
    }

    const raw = error instanceof Error ? error.message : "Square request failed";
    return redactSecrets(`Square ${path} failed: ${raw}`, [this.accessToken]);
  }
}

function objectsFrom(
  payload: SquareJson,
  key: string,
): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as unknown[]).filter(isPlainObject);
}

function stringField(payload: SquareJson, key: string): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(payload: SquareJson, key: string): number | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const value = payload[key];
  return typeof value === "number" ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeErrorSuffix(payload: SquareJson | undefined): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }

  const errors = payload.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return "";
  }

  const codes = (errors as unknown[])
    .filter(isPlainObject)
    .map((entry) => entry.code)
    .filter((code): code is string => typeof code === "string")
    .slice(0, 3);

  return codes.length > 0 ? ` (${codes.join(", ")})` : "";
}

async function readJsonSafe(response: Response): Promise<SquareJson | undefined> {
  try {
    return (await response.json()) as SquareJson;
  } catch {
    return undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
