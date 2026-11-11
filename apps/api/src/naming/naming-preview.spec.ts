import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test, { before, after, describe } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { EnvService } from "../config/env.service";
import { NamingObjectService } from "./naming-object.service";
import type { NamingObjectRecord } from "./naming-object.service";
import { NamingPhotoController } from "./naming-inventory.controller";
import { NamingPreviewController } from "./naming-preview.controller";
import {
  previewRequestAllowed,
  selectPreviewCatalog,
  type PreviewSourceObject,
} from "./naming-preview";
import { NamingPublicController } from "./naming-public.controller";
import { NamingPublicService } from "./naming-public.service";
import { NamingRateLimiter } from "./naming-rate-limit";

const GIFT_CARD_HOST = "giftcard.udderlyridiculousfarmlife.com";
const photoDir = mkdtempSync(join(tmpdir(), "naming-preview-"));
const realId = "11111111-1111-4111-8111-111111111111";
const hiddenId = "22222222-2222-4222-8222-222222222222";
const publishedId = "33333333-3333-4333-8333-333333333333";
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

test("preview access stays on the gift-card host and the exact flag", () => {
  assert.equal(
    previewRequestAllowed({
      previewMode: false,
      nodeEnv: "production",
      host: GIFT_CARD_HOST,
    }),
    false,
  );
  assert.equal(
    previewRequestAllowed({
      previewMode: true,
      nodeEnv: "production",
      host: "goatbarn.udderlyridiculousfarmlife.com",
    }),
    false,
  );
  assert.equal(
    previewRequestAllowed({
      previewMode: true,
      nodeEnv: "production",
      host: `${GIFT_CARD_HOST}:443`,
    }),
    true,
  );
  assert.equal(
    previewRequestAllowed({
      previewMode: true,
      nodeEnv: "development",
      host: "127.0.0.1:3001",
    }),
    true,
  );
});

test("the preview catalogue keeps 74 real available objects and protected photos", () => {
  const objects = [
    ...priced("bucket", 32, 10_000),
    ...priced("slide", 32, 25_000),
    ...priced("tractor", 8, 50_000),
    ...priced("tower", 2, 100_000),
    source({
      name: "Test Naming Bucket",
      priceAmount: 2000,
      status: "claimed",
    }),
    source({
      name: "Published gate",
      priceAmount: 10_000,
      publishedAt: new Date("2026-11-01T00:00:00Z"),
    }),
    source({
      name: "Held pail",
      priceAmount: 10_000,
      status: "held",
    }),
  ];
  const catalog = selectPreviewCatalog(objects);
  assert.equal(catalog.length, 74);
  assert.equal(catalog.filter((object) => object.priceCents === 10_000).length, 32);
  assert.equal(catalog.filter((object) => object.priceCents === 25_000).length, 32);
  assert.equal(catalog.filter((object) => object.priceCents === 50_000).length, 8);
  assert.equal(catalog.filter((object) => object.priceCents === 100_000).length, 2);
  assert.equal(
    catalog.some((object) => object.name.toLowerCase() === "test naming bucket"),
    false,
  );
  assert.equal(catalog.some((object) => object.name === "Published gate"), false);
  assert.equal(catalog.some((object) => object.name === "Held pail"), false);
  for (const object of catalog) {
    assert.match(
      object.photoUrl ?? "",
      /^\/naming\/preview\/photos\/[0-9a-f-]{36}\.jpg$/,
    );
    assert.equal(object.photoUrl?.startsWith("/photos/"), false);
    assert.equal(object.availability, "available");
  }
});

const rows: NamingObjectRecord[] = [];
const envStub = {
  nodeEnv: "production" as "production" | "development",
  namingPreviewMode: true,
  namingCampaignEnabled: false,
  namingPhotoDir: photoDir,
};
let listCalls = 0;
let app: NestExpressApplication | undefined;
let baseUrl = "";

describe("preview catalogue routes", { concurrency: false }, () => {
  before(async () => {
    writeFileSync(join(photoDir, `${realId}.jpg`), jpeg);
    writeFileSync(join(photoDir, `${hiddenId}.jpg`), jpeg);
    writeFileSync(join(photoDir, `${publishedId}.jpg`), jpeg);
    rows.push(
      record(realId, "Blue Bucket", 10_000, null, "available"),
      record(hiddenId, "Test Naming Bucket", 2000, null, "claimed"),
      record(publishedId, "Public tractor", 50_000, new Date(), "available"),
    );
    const application = await NestFactory.create<NestExpressApplication>(
      PreviewTestModule,
      { logger: false },
    );
    await application.listen(0, "127.0.0.1");
    app = application;
    const address = application.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await app?.close();
  });

  test("a disabled preview and the goat barn host reveal nothing", async () => {
    envStub.namingPreviewMode = false;
    const closed = await ask("/naming/preview/catalog", GIFT_CARD_HOST);
    assert.equal(closed.status, 404);
    assert.equal(closed.body.includes("Blue Bucket"), false);
    envStub.namingPreviewMode = true;
    const calls = listCalls;
    const goatbarn = await ask(
      "/naming/preview/catalog",
      "goatbarn.udderlyridiculousfarmlife.com",
    );
    assert.equal(goatbarn.status, 404);
    assert.equal(goatbarn.body.includes("Blue Bucket"), false);
    assert.equal(listCalls, calls);
    const photo = await ask(
      `/naming/preview/photos/${realId}.jpg`,
      "goatbarn.udderlyridiculousfarmlife.com",
    );
    assert.equal(photo.status, 404);
  });

  test("the gift-card preview lists real objects and serves only their photos", async () => {
    envStub.namingPreviewMode = true;
    envStub.nodeEnv = "production";
    const catalog = await ask("/naming/preview/catalog", GIFT_CARD_HOST);
    assert.equal(catalog.status, 200);
    const body = JSON.parse(catalog.body) as {
      objects: { name: string; photoUrl: string }[];
    };
    assert.deepEqual(
      body.objects.map((object) => object.name),
      ["Blue Bucket"],
    );
    assert.equal(
      body.objects[0]?.photoUrl,
      `/naming/preview/photos/${realId}.jpg`,
    );
    const photo = await ask(body.objects[0].photoUrl, GIFT_CARD_HOST);
    assert.equal(photo.status, 200);
    assert.match(photo.type, /image\/jpeg/);
    const hidden = await ask(
      `/naming/preview/photos/${hiddenId}.jpg`,
      GIFT_CARD_HOST,
    );
    assert.equal(hidden.status, 404);
    const publishedPhoto = await ask(`/photos/${realId}.jpg`, GIFT_CARD_HOST);
    assert.equal(publishedPhoto.status, 404);
    const publicCatalog = await ask("/naming/objects", GIFT_CARD_HOST);
    assert.equal(publicCatalog.status, 404);
    assert.equal(publicCatalog.body.includes("Blue Bucket"), false);
    const reservation = await ask("/naming/reservations", GIFT_CARD_HOST, "POST");
    assert.equal(reservation.status, 404);
  });
});

function priced(
  label: string,
  count: number,
  priceAmount: number,
): PreviewSourceObject[] {
  return Array.from({ length: count }, (_, index) =>
    source({
      id: randomUUID(),
      name: `${label} ${index}`,
      priceAmount,
    }),
  );
}

function source(
  overrides: Partial<PreviewSourceObject> & { name: string },
): PreviewSourceObject {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    description: "A farm object",
    photoUrl: `/photos/${id}.jpg`,
    priceAmount: 10_000,
    currency: "CAD",
    publishedAt: null,
    status: "available",
    ...overrides,
  };
}

function record(
  id: string,
  name: string,
  priceAmount: number,
  publishedAt: Date | null,
  status: string,
): NamingObjectRecord {
  return {
    id,
    name,
    description: "A farm object",
    photoUrl: `/photos/${id}.jpg`,
    priceAmount,
    currency: "CAD",
    publishedAt,
    status,
  };
}

function ask(
  path: string,
  host: string,
  method = "GET",
): Promise<{ status: number; body: string; type: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${baseUrl}${path}`,
      { method, headers: { host, "content-type": "application/json" } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            type: String(response.headers["content-type"] ?? ""),
          }),
        );
      },
    );
    req.on("error", reject);
    if (method === "POST") {
      req.write(JSON.stringify({ objectId: realId }));
    }
    req.end();
  });
}

const objectService = {
  async list(): Promise<NamingObjectRecord[]> {
    listCalls += 1;
    return rows;
  },
};

@Module({
  controllers: [
    NamingPreviewController,
    NamingPhotoController,
    NamingPublicController,
  ],
  providers: [
    NamingRateLimiter,
    { provide: NamingObjectService, useValue: objectService },
    { provide: EnvService, useValue: envStub },
    {
      provide: NamingPublicService,
      useValue: {
        listPublished() {
          throw new Error("published catalog");
        },
        createReservation() {
          throw new Error("reservation");
        },
      },
    },
  ],
})
class PreviewTestModule {}
