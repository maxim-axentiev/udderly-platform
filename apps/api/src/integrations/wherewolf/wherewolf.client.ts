import {
  WHEREWOLF_API_BASE_URL,
  WHEREWOLF_GUEST_SELECTION_CROPPED,
  WHEREWOLF_REQUEST_TIMEOUT_MS,
} from "./wherewolf.constants";
import { redactSecrets, WherewolfApiError } from "./wherewolf.errors";
import type {
  WherewolfClientConfig,
  WherewolfGuestGetByFilterRequest,
  WherewolfJson,
  WherewolfReservationsGetRequest,
  WherewolfUtcRange,
} from "./wherewolf.types";

export class WherewolfClient {
  private readonly apiKey: string;
  private readonly appId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: WherewolfClientConfig) {
    this.apiKey = config.apiKey;
    this.appId = config.appId;
    this.baseUrl = (config.baseUrl ?? WHEREWOLF_API_BASE_URL).replace(
      /\/$/,
      "",
    );
    this.timeoutMs = config.timeoutMs ?? WHEREWOLF_REQUEST_TIMEOUT_MS;
  }

  async getReservations(range: WherewolfUtcRange): Promise<WherewolfJson> {
    const body: WherewolfReservationsGetRequest = {
      dateBegin: range.dateBegin,
      dateEnd: range.dateEnd,
      key: this.apiKey,
      pool: this.appId,
    };

    return this.post("/reservations/get", body);
  }

  async getGuestsByFilter(
    range: WherewolfUtcRange,
    limit: number,
  ): Promise<WherewolfJson> {
    const body: WherewolfGuestGetByFilterRequest = {
      filter: {
        dateRange: {
          dateAfter: range.dateBegin,
          dateBefore: range.dateEnd,
        },
      },
      limit,
      selection: WHEREWOLF_GUEST_SELECTION_CROPPED,
      key: this.apiKey,
      pool: this.appId,
    };

    return this.post("/guest/getByFilter", body);
  }

  private async post(path: string, body: unknown): Promise<WherewolfJson> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new WherewolfApiError(this.safeErrorMessage(path, error));
    }

    if (!response.ok) {
      throw new WherewolfApiError(
        `Wherewolf ${path} failed with HTTP ${response.status}`,
        response.status,
      );
    }

    try {
      return (await response.json()) as WherewolfJson;
    } catch {
      throw new WherewolfApiError(
        `Wherewolf ${path} returned a non-JSON response`,
        response.status,
      );
    }
  }

  private safeErrorMessage(path: string, error: unknown): string {
    if (error instanceof Error && error.name === "TimeoutError") {
      return `Wherewolf ${path} timed out`;
    }

    if (error instanceof Error && error.name === "AbortError") {
      return `Wherewolf ${path} timed out`;
    }

    const raw =
      error instanceof Error ? error.message : "Wherewolf request failed";

    return redactSecrets(`Wherewolf ${path} failed: ${raw}`, [
      this.apiKey,
      this.appId,
    ]);
  }
}
