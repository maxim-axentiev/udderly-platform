import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, describe } from "node:test";
import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { validateEnv } from "../config/env";
import { EnvService } from "../config/env.service";
import { DatabaseService } from "../database/database.service";
import {
  NamingInventoryController,
  NamingPhotoController,
} from "./naming-inventory.controller";
import { PHOTO_MAX_BYTES, applyInventoryPhotoParser } from "./naming-inventory.photo";
import {
  createCsrfToken,
  openInventorySession,
  passwordsMatch,
  signInventorySession,
} from "./naming-inventory.session";
import { InventorySessions } from "./naming-inventory.sessions";
import { NamingObjectService } from "./naming-object.service";
import { NamingPublicController } from "./naming-public.controller";
import { NamingPublicService } from "./naming-public.service";
import { NamingRateLimiter } from "./naming-rate-limit";
import { NamingStaffService } from "./naming-staff.service";

const PASSWORD = "staff-password";
const SESSION_SECRET = "session-secret-must-be-at-least-32";

test("inventory auth is absent or complete and does not echo secrets", () => {
  const base = {
    DATABASE_URL: "postgresql://postgres:naming@127.0.0.1:55432/naming",
    REDIS_URL: "redis://127.0.0.1:6379",
  };
  assert.equal(validateEnv(base).NAMING_ADMIN_PASSWORD, undefined);
  assert.throws(
    () => validateEnv({ ...base, NAMING_ADMIN_PASSWORD: PASSWORD }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(PASSWORD), false);
      return true;
    },
  );
  assert.throws(() =>
    validateEnv({
      ...base,
      NAMING_ADMIN_PASSWORD: "short",
      NAMING_ADMIN_SESSION_SECRET: SESSION_SECRET,
    }),
  );
  const configured = validateEnv({
    ...base,
    NAMING_ADMIN_PASSWORD: PASSWORD,
    NAMING_ADMIN_SESSION_SECRET: SESSION_SECRET,
  });
  assert.equal(configured.NAMING_ADMIN_PASSWORD, PASSWORD);
  assert.equal(configured.NAMING_CAMPAIGN_ENABLED, false);
});

test("a session signed with the staff password is rejected", () => {
  const csrf = createCsrfToken();
  const sid = "abcdefghij1234567890ab";
  const expiresAt = Date.now() + 60_000;
  const token = signInventorySession(PASSWORD, expiresAt, csrf, sid);
  assert.equal(openInventorySession(SESSION_SECRET, token, Date.now()), undefined);
  assert.equal(passwordsMatch(PASSWORD, PASSWORD), true);
  assert.equal(passwordsMatch("other-password", PASSWORD), false);
  const expired = signInventorySession(
    SESSION_SECRET,
    Date.now() - 1_000,
    csrf,
    sid,
  );
  assert.equal(openInventorySession(SESSION_SECRET, expired, Date.now()), undefined);
});

type StoredObject = {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  priceAmount: number;
  currency: string;
  publishedAt: Date | null;
  isTest?: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

const rows: StoredObject[] = [];
let failUpdates = 0;
const photoDir = mkdtempSync(join(tmpdir(), "naming-photos-"));
const publicCalls = { list: 0 };
let app: NestExpressApplication | undefined;
let baseUrl = "";

describe("inventory routes", { concurrency: false }, () => {
  before(async () => {
    const application = await NestFactory.create<NestExpressApplication>(
      InventoryTestModule,
      { logger: false },
    );
    application.set("trust proxy", 1);
    application.useBodyParser("json", { limit: "2mb" });
    await application.listen(0, "127.0.0.1");
    const address = application.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    app = application;
  });

  after(async () => {
    await app?.close();
    rmSync(photoDir, { recursive: true, force: true });
  });

  test("missing configuration hides inventory writes", async () => {
    const closed = await NestFactory.create<NestExpressApplication>(
      ClosedInventoryModule,
      { logger: false },
    );
    await closed.listen(0, "127.0.0.1");
    const address = closed.getHttpServer().address() as AddressInfo;
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/inventory/objects`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Gate", description: "", priceCents: 2000 }),
        },
      );
      assert.equal(response.status, 404);
      assert.equal(rows.length, 0);
    } finally {
      await closed.close();
    }
  });

  test("naming corrections require the staff session and CSRF token", async () => {
    reset();
    const session = await login("203.0.113.19");
    const created = await mutate(session, "POST", "/inventory/objects", {
      name: "Named gate",
      description: "",
      priceCents: 25000,
    });
    const object = (await created.json()) as InventoryBody;
    const anonymous = await fetch(`${baseUrl}/inventory/objects/${object.id}/naming`);
    assert.equal(anonymous.status, 401);
    const missingCsrf = await fetch(
      `${baseUrl}/inventory/objects/${object.id}/naming/correction`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({ name: "Buttercup" }),
      },
    );
    assert.equal(missingCsrf.status, 403);
    const unconfirmed = await mutate(
      session,
      "POST",
      `/inventory/objects/${object.id}/naming/resend`,
      { confirm: "send" },
    );
    assert.equal(unconfirmed.status, 400);
  });

  test("login sets a strict cookie and rejects a missing CSRF token", async () => {
    reset();
    const session = await login("203.0.113.10");
    assert.match(session.cookieHeader, /HttpOnly/i);
    assert.match(session.cookieHeader, /Secure/i);
    assert.match(session.cookieHeader, /SameSite=Strict/i);
    assert.match(session.cookieHeader, /Path=\/inventory/i);
    const created = await fetch(`${baseUrl}/inventory/objects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({ name: "North gate", description: "", priceCents: 2000 }),
    });
    assert.equal(created.status, 403);
    assert.equal(rows.length, 0);
  });

  test("a staff session can prepare inventory while the campaign is off", async () => {
    reset();
    const session = await login("203.0.113.11");
    const naming = await fetch(`${baseUrl}/naming/objects`);
    assert.equal(naming.status, 404);
    assert.equal(publicCalls.list, 0);
    const unauthenticated = await fetch(`${baseUrl}/inventory/objects`);
    assert.equal(unauthenticated.status, 401);
    const created = await mutate(session, "POST", "/inventory/objects", {
      name: "North gate",
      description: "Painted",
      priceCents: 2000,
      publish: true,
    });
    assert.equal(created.status, 400);
    const object = await mutate(session, "POST", "/inventory/objects", {
      name: "North gate",
      description: "Painted",
      priceCents: 2000,
    });
    assert.equal(object.status, 201);
    const body = (await object.json()) as InventoryBody;
    assert.equal(body.published, false);
    assert.equal(body.availability, "available");
    assert.equal(body.priceCents, 2000);
    assert.equal(body.photoUrl, null);
    assert.equal(body.isTest, false);
    assert.equal(forbiddenFields(body), false);
    const listed = await fetch(`${baseUrl}/inventory/objects`, {
      headers: { cookie: session.cookie },
    });
    assert.equal(listed.status, 200);
    const catalog = (await listed.json()) as { objects: InventoryBody[] };
    assert.equal(catalog.objects.length, 1);
    assert.equal(forbiddenFields(catalog), false);
  });

  test("staff can see a test object and cannot publish it", async () => {
    reset();
    const session = await login("203.0.113.21");
    const created = await mutate(session, "POST", "/inventory/objects", {
      name: "Campaign Test Object $100",
      description: "",
      priceCents: 10000,
      isTest: true,
    });
    assert.equal(created.status, 201);
    const body = (await created.json()) as InventoryBody;
    assert.equal(body.isTest, true);
    assert.equal(body.published, false);
    assert.equal(body.priceCents, 10000);
    const listed = await fetch(`${baseUrl}/inventory/objects`, {
      headers: { cookie: session.cookie },
    });
    const catalog = (await listed.json()) as { objects: InventoryBody[] };
    assert.equal(catalog.objects.length, 1);
    assert.equal(catalog.objects[0]?.isTest, true);
    const published = await mutate(session, "PATCH", `/inventory/objects/${body.id}`, {
      published: true,
    });
    assert.equal(published.status, 409);
    assert.equal(rows[0]?.publishedAt, null);
    assert.equal(rows[0]?.isTest, true);
  });

  test("held and claimed objects keep their price and cannot be published", async () => {
    reset();
    const session = await login("203.0.113.12");
    const created = await mutate(session, "POST", "/inventory/objects", {
      name: "Bucket",
      description: "",
      priceCents: 2000,
    });
    const object = (await created.json()) as InventoryBody;
    rows[0].status = "held";
    const priced = await mutate(session, "PATCH", `/inventory/objects/${object.id}`, {
      priceCents: 3000,
    });
    assert.equal(priced.status, 409);
    assert.equal(rows[0].priceAmount, 2000);
    const published = await mutate(session, "PATCH", `/inventory/objects/${object.id}`, {
      published: true,
    });
    assert.equal(published.status, 409);
    assert.equal(rows[0].publishedAt, null);
    rows[0].publishedAt = new Date("2026-11-03T00:00:00Z");
    rows[0].status = "claimed";
    const unpublished = await mutate(
      session,
      "PATCH",
      `/inventory/objects/${object.id}`,
      { published: false },
    );
    assert.equal(unpublished.status, 200);
    assert.equal(rows[0].publishedAt, null);
    assert.equal(rows[0].status, "claimed");
    const ownership = await mutate(session, "PATCH", `/inventory/objects/${object.id}`, {
      claimedReservationId: randomUUID(),
    });
    assert.equal(ownership.status, 400);
    assert.equal(rows[0].status, "claimed");
  });

  test("a valid cookie restores a csrf token without a new password", async () => {
    reset();
    const session = await login("203.0.113.16");
    const restored = await fetch(`${baseUrl}/inventory/session`, {
      headers: { cookie: session.cookie },
    });
    assert.equal(restored.status, 200);
    const body = (await restored.json()) as { csrfToken?: string; expiresAt?: string };
    assert.equal(typeof body.csrfToken, "string");
    assert.notEqual(body.csrfToken, session.csrf);
    assert.equal(body.expiresAt, session.expiresAt);
    const text = JSON.stringify(body);
    assert.equal(text.includes(PASSWORD), false);
    assert.equal(text.includes(SESSION_SECRET), false);
    const cookieHeader = restored.headers.get("set-cookie") ?? "";
    assert.match(cookieHeader, /HttpOnly/i);
    assert.match(cookieHeader, /Secure/i);
    assert.match(cookieHeader, /SameSite=Strict/i);
    assert.match(cookieHeader, /Path=\/inventory/i);
    const nextCookie = cookieHeader.split(";")[0] ?? "";
    const stale = await fetch(`${baseUrl}/inventory/objects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
        "x-csrf-token": session.csrf,
      },
      body: JSON.stringify({ name: "Stale", description: "", priceCents: 100 }),
    });
    assert.equal(stale.status, 401);
    const created = await fetch(`${baseUrl}/inventory/objects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: nextCookie,
        "x-csrf-token": body.csrfToken,
      },
      body: JSON.stringify({ name: "Restored", description: "", priceCents: 100 }),
    });
    assert.equal(created.status, 201);
    const anonymous = await fetch(`${baseUrl}/inventory/session`);
    assert.equal(anonymous.status, 401);
  });

  test("logout and expiry both end the session", async () => {
    reset();
    const session = await login("203.0.113.13");
    const expired = signInventorySession(
      SESSION_SECRET,
      Date.now() - 1_000,
      session.csrf,
      "abcdefghij1234567890ab",
    );
    const expiredResponse = await fetch(`${baseUrl}/inventory/objects`, {
      headers: { cookie: `naming_inventory=${expired}` },
    });
    assert.equal(expiredResponse.status, 401);
    const logout = await fetch(`${baseUrl}/inventory/session/logout`, {
      method: "POST",
      headers: { cookie: session.cookie, "x-csrf-token": session.csrf },
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/i);
    const again = await fetch(`${baseUrl}/inventory/objects`, {
      headers: { cookie: session.cookie },
    });
    assert.equal(again.status, 401);
  });

  test("login attempts are rate limited", async () => {
    const headers = {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.14",
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${baseUrl}/inventory/session`, {
        method: "POST",
        headers,
        body: JSON.stringify({ password: "wrong-password" }),
      });
      assert.equal(response.status, 401);
    }
    const blocked = await fetch(`${baseUrl}/inventory/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(blocked.status, 429);
  });

  test("photographs are stored by signature and a failed upload keeps the old reference", async () => {
    reset();
    const session = await login("203.0.113.15");
    const created = await mutate(session, "POST", "/inventory/objects", {
      name: "Tractor",
      description: "",
      priceCents: 50000,
    });
    const object = (await created.json()) as InventoryBody;
    const svg = await upload(session, object.id, Buffer.from("<svg></svg>"));
    assert.equal(svg.status, 400);
    assert.equal(rows[0].photoUrl, null);
    const oversized = Buffer.alloc(PHOTO_MAX_BYTES + 1, 0xff);
    const tooBig = await upload(session, object.id, oversized);
    assert.equal(tooBig.status, 413);
    assert.equal(rows[0].photoUrl, null);
    failUpdates = 1;
    const failed = await upload(session, object.id, jpeg());
    assert.equal(failed.status, 500);
    assert.equal(rows[0].photoUrl, null);
    assert.equal(
      readdirSync(photoDir).some((name) => name.endsWith(".jpg") || name.endsWith(".tmp")),
      false,
    );
    const saved = await upload(session, object.id, jpeg());
    assert.equal(saved.status, 201);
    const body = (await saved.json()) as InventoryBody;
    assert.equal(body.photoUrl, `/photos/${object.id}.jpg`);
    const hidden = await fetch(`${baseUrl}${body.photoUrl}`);
    assert.equal(hidden.status, 404);
    const staffPhoto = await fetch(`${baseUrl}/inventory${body.photoUrl}`, {
      headers: { cookie: session.cookie },
    });
    assert.equal(staffPhoto.status, 200);
    assert.equal(staffPhoto.headers.get("content-type"), "image/jpeg");
    assert.equal(staffPhoto.headers.get("x-content-type-options"), "nosniff");
    const bytes = Buffer.from(await staffPhoto.arrayBuffer());
    assert.equal(bytes[0], 0xff);
    const published = await mutate(session, "PATCH", `/inventory/objects/${object.id}`, {
      published: true,
    });
    assert.equal(published.status, 200);
    const photo = await fetch(`${baseUrl}${body.photoUrl}`);
    assert.equal(photo.status, 200);
    const unpublished = await mutate(session, "PATCH", `/inventory/objects/${object.id}`, {
      published: false,
    });
    assert.equal(unpublished.status, 200);
    const hiddenAgain = await fetch(`${baseUrl}${body.photoUrl}`);
    assert.equal(hiddenAgain.status, 404);
    const staffAgain = await fetch(`${baseUrl}/inventory${body.photoUrl}`, {
      headers: { cookie: session.cookie },
    });
    assert.equal(staffAgain.status, 200);
    const escaped = await fetch(`${baseUrl}/photos/..%2f..%2fpackage.json`);
    assert.equal(escaped.status, 404);
    const svgName = await fetch(`${baseUrl}/photos/${object.id}.svg`);
    assert.equal(svgName.status, 404);
    const listing = await fetch(`${baseUrl}/photos/`);
    assert.equal(listing.status, 404);
  });
});

type InventoryBody = {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  priceCents: number;
  currency: string;
  availability: string;
  published: boolean;
  isTest: boolean;
};

function reset(): void {
  rows.splice(0, rows.length);
  failUpdates = 0;
}

function jpeg(): Buffer {
  const bytes = Buffer.alloc(32);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return bytes;
}

async function login(ip: string): Promise<{
  cookie: string;
  cookieHeader: string;
  csrf: string;
  expiresAt: string;
}> {
  const response = await fetch(`${baseUrl}/inventory/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { csrfToken?: string; expiresAt?: string };
  const cookieHeader = response.headers.get("set-cookie") ?? "";
  assert.equal(typeof body.csrfToken, "string");
  return {
    cookie: cookieHeader.split(";")[0] ?? "",
    cookieHeader,
    csrf: body.csrfToken ?? "",
    expiresAt: body.expiresAt ?? "",
  };
}

async function mutate(
  session: { cookie: string; csrf: string },
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
    },
    body: JSON.stringify(body),
  });
}

async function upload(
  session: { cookie: string; csrf: string },
  id: string,
  bytes: Buffer,
): Promise<Response> {
  return fetch(`${baseUrl}/inventory/objects/${id}/photo`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
    },
    body: new Uint8Array(bytes),
  });
}

function forbiddenFields(value: unknown): boolean {
  const text = JSON.stringify(value);
  return (
    text.includes("checkoutRef") ||
    text.includes("namingToken") ||
    text.includes("submittedName") ||
    text.includes("paidAmount") ||
    text.includes("fareharbor")
  );
}

function memoryDatabase(stored: StoredObject[]) {
  return {
    db: {
      insert() {
        return {
          values(values: Omit<StoredObject, "id" | "createdAt" | "updatedAt">) {
            return {
              async returning() {
                const row: StoredObject = {
                  id: randomUUID(),
                  createdAt: new Date("2026-11-03T00:00:00Z"),
                  updatedAt: new Date("2026-11-03T00:00:00Z"),
                  ...values,
                };
                stored.push(row);
                return [row];
              },
            };
          },
        };
      },
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  limit() {
                    return Promise.resolve(stored.slice(0, 1));
                  },
                };
              },
              orderBy() {
                return Promise.resolve([...stored]);
              },
            };
          },
        };
      },
      update() {
        return {
          set(patch: Partial<StoredObject>) {
            return {
              where() {
                return {
                  async returning() {
                    if (failUpdates > 0) {
                      failUpdates -= 1;
                      throw new Error("database unavailable");
                    }
                    if (stored.length === 0) {
                      return [];
                    }
                    Object.assign(stored[0], patch, { updatedAt: new Date() });
                    return [stored[0]];
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

const staffStub = {
  async view() {
    return undefined;
  },
  async correct() {
    return { outcome: "not_found" };
  },
  async resend() {
    return { outcome: "not_found" };
  },
};

const envStub = {
  namingAdmin: { password: PASSWORD, sessionSecret: SESSION_SECRET },
  namingPhotoDir: photoDir,
  namingCampaignEnabled: false,
};

@Module({
  controllers: [
    NamingInventoryController,
    NamingPhotoController,
    NamingPublicController,
  ],
  providers: [
    NamingObjectService,
    NamingRateLimiter,
    InventorySessions,
    { provide: DatabaseService, useValue: memoryDatabase(rows) },
    { provide: EnvService, useValue: envStub },
    {
      provide: NamingPublicService,
      useValue: {
        listPublished() {
          publicCalls.list += 1;
          return { objects: [] };
        },
      },
    },
    { provide: NamingStaffService, useValue: staffStub },
  ],
})
class InventoryTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    applyInventoryPhotoParser(consumer);
  }
}

@Module({
  controllers: [NamingInventoryController],
  providers: [
    NamingObjectService,
    NamingRateLimiter,
    InventorySessions,
    { provide: DatabaseService, useValue: memoryDatabase(rows) },
    {
      provide: EnvService,
      useValue: { namingAdmin: undefined, namingPhotoDir: photoDir },
    },
    { provide: NamingStaffService, useValue: staffStub },
  ],
})
class ClosedInventoryModule {}
