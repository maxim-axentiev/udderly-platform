import { Injectable } from "@nestjs/common";
import { AppEnv, validateEnv } from "./env";

@Injectable()
export class EnvService {
  private readonly env: AppEnv;

  constructor() {
    this.env = validateEnv();
  }

  get nodeEnv(): AppEnv["NODE_ENV"] {
    return this.env.NODE_ENV;
  }

  get apiPort(): number {
    return this.env.API_PORT;
  }

  get apiListenHost(): string {
    return this.env.API_LISTEN_HOST;
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  get webOrigin(): string {
    return this.env.WEB_ORIGIN;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === "production";
  }

  get wherewolfApiKey(): string | undefined {
    return this.env.WHEREWOLF_API_KEY;
  }

  get wherewolfAppId(): string | undefined {
    return this.env.WHEREWOLF_APP_ID;
  }

  get isWherewolfConfigured(): boolean {
    return Boolean(this.env.WHEREWOLF_API_KEY && this.env.WHEREWOLF_APP_ID);
  }

  get fareharborWebhookSecret(): string | undefined {
    return this.env.FAREHARBOR_WEBHOOK_SECRET;
  }

  get isFareharborWebhookConfigured(): boolean {
    return Boolean(this.env.FAREHARBOR_WEBHOOK_SECRET);
  }

  get squareAccessToken(): string | undefined {
    return this.env.SQUARE_ACCESS_TOKEN;
  }

  get squareApplicationId(): string | undefined {
    return this.env.SQUARE_APPLICATION_ID;
  }

  get squareLocationId(): string | undefined {
    return this.env.SQUARE_LOCATION_ID;
  }

  get isSquareConfigured(): boolean {
    return Boolean(
      this.env.SQUARE_ACCESS_TOKEN &&
        this.env.SQUARE_APPLICATION_ID &&
        this.env.SQUARE_LOCATION_ID,
    );
  }

  get googleAnalytics():
    | {
        propertyId: string;
        clientId: string;
        clientSecret: string;
        refreshToken: string;
      }
    | undefined {
    const propertyId = this.env.GOOGLE_ANALYTICS_PROPERTY_ID;
    const clientId = this.env.GOOGLE_ANALYTICS_CLIENT_ID;
    const clientSecret = this.env.GOOGLE_ANALYTICS_CLIENT_SECRET;
    const refreshToken = this.env.GOOGLE_ANALYTICS_REFRESH_TOKEN;
    if (!propertyId || !clientId || !clientSecret || !refreshToken) {
      return undefined;
    }
    return { propertyId, clientId, clientSecret, refreshToken };
  }

  get isGoogleAnalyticsConfigured(): boolean {
    return Boolean(this.googleAnalytics);
  }

  get googleSearchConsole():
    | {
        siteUrl: string;
        clientId: string;
        clientSecret: string;
        refreshToken: string;
      }
    | undefined {
    const siteUrl = this.env.GOOGLE_SEARCH_CONSOLE_SITE_URL;
    const clientId = this.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID;
    const clientSecret = this.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET;
    const refreshToken = this.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN;
    if (!siteUrl || !clientId || !clientSecret || !refreshToken) {
      return undefined;
    }
    return { siteUrl, clientId, clientSecret, refreshToken };
  }

  get isGoogleSearchConsoleConfigured(): boolean {
    return Boolean(this.googleSearchConsole);
  }
}
