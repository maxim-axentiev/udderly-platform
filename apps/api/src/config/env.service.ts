import { Injectable } from "@nestjs/common";
import { parseFareharborTierCheckouts } from "@udderly/shared";
import { META_ADS_CANONICAL_ACCOUNT_ID } from "../integrations/meta-ads/meta-ads.constants";
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

  get metaAds():
    | {
        accountId: string;
        accessToken: string;
      }
    | undefined {
    const accountId = this.env.META_ADS_ACCOUNT_ID;
    const accessToken = this.env.META_ADS_ACCESS_TOKEN;
    if (!accountId && !accessToken) {
      return undefined;
    }
    if (!accountId || !accessToken) {
      throw new Error("meta_ads_env_incomplete");
    }
    if (accountId !== META_ADS_CANONICAL_ACCOUNT_ID) {
      throw new Error("meta_ads_account_id_not_canonical");
    }
    return { accountId, accessToken };
  }

  get isMetaAdsConfigured(): boolean {
    return Boolean(this.metaAds);
  }

  get mailchimp(): { apiKey: string } | undefined {
    const apiKey = this.env.MAILCHIMP_API_KEY;
    if (!apiKey) {
      return undefined;
    }
    return { apiKey };
  }

  get isMailchimpConfigured(): boolean {
    return Boolean(this.mailchimp);
  }

  get namingCampaignEnabled(): boolean {
    return this.env.NAMING_CAMPAIGN_ENABLED;
  }

  get fareharborTierCheckouts() {
    return parseFareharborTierCheckouts(this.env.NAMING_FAREHARBOR_TIERS);
  }

  get namingAdmin():
    | { password: string; sessionSecret: string }
    | undefined {
    const password = this.env.NAMING_ADMIN_PASSWORD;
    const sessionSecret = this.env.NAMING_ADMIN_SESSION_SECRET;
    if (!password || !sessionSecret) {
      return undefined;
    }
    return { password, sessionSecret };
  }

  get namingPhotoDir(): string {
    return this.env.NAMING_PHOTO_DIR ?? "/data/naming-photos";
  }

  get namingResend():
    | { apiKey: string; from: string; replyTo: string }
    | undefined {
    const apiKey = this.env.RESEND_API_KEY;
    const from = this.env.RESEND_FROM;
    const replyTo = this.env.RESEND_REPLY_TO;
    if (!apiKey || !from || !replyTo) {
      return undefined;
    }
    return { apiKey, from, replyTo };
  }

  get namingSmtp():
    | { user: string; appPassword: string; from: string }
    | undefined {
    const user = this.env.SMTP_USER;
    const appPassword = this.env.SMTP_APP_PASSWORD;
    const from = this.env.SMTP_FROM;
    if (!user || !appPassword || !from) {
      return undefined;
    }
    return { user, appPassword, from };
  }

  get namingMailConfigured(): boolean {
    return Boolean(this.namingResend || this.namingSmtp);
  }

  get namingPublicBaseUrl(): string | undefined {
    return this.env.NAMING_PUBLIC_BASE_URL;
  }
}
