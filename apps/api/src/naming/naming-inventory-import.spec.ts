import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { EnvService } from "../config/env.service";
import {
  applySqlMigrations,
  NAMING_SCHEMA_MIGRATIONS,
} from "../database/apply-sql-migration";
import { DatabaseService } from "../database/database.service";
import { namingObjects, namingReservations } from "../database/schema/naming";
import { connectStaffInventory } from "./naming-inventory-import.client";
import { parseImportArgs, runImportCli } from "./naming-inventory-import.cli";
import {
  NamingInventoryController,
  NamingPhotoController,
} from "./naming-inventory.controller";
import { applyInventoryPhotoParser } from "./naming-inventory.photo";
import { InventorySessions } from "./naming-inventory.sessions";
import { NamingObjectService } from "./naming-object.service";
import { NamingStaffService } from "./naming-staff.service";
import { NamingRateLimiter } from "./naming-rate-limit";
import {
  parseManifest,
  runInventoryImport,
  type ExistingObject,
  type InventoryApi,
  type ManifestRow,
} from "./naming-inventory-import";

const PASSWORD = "local-staff-password";
const SESSION_SECRET = "local-session-secret-at-least-32";
const BUCKET_ID = "15898afd-b977-48b6-adb3-5a1eed602468";
const repoRoot = resolve(__dirname, "../../../..");
const campaignManifest = join(repoRoot, "assets/gift-card-campaign/inventory-manifest.csv");

test("manifest cells and price tiers stay exact", () => {
  const parsed = parseManifest(
    [
      "object_name,description,price_tier,price_cad_cents,original_photograph_path,square_photograph_path,image_processing_status,matching_or_validation_notes,import_readiness",
      'Goat Barn,"The barn, with ""quotes"".","$1,000",100000,originals/barn.JPEG,square/barn.jpg,generated,Note,ready',
      "Run In Shed,Left unmatched.,$250,25000,,,not-generated,No photograph was confidently matched.,review",
    ].join("\n"),
  );
  assert.equal(parsed[0]?.description, 'The barn, with "quotes".');
  assert.equal(parsed[0]?.tier, "$1,000");
  assert.equal(parsed[0]?.priceCents, 100000);
  assert.equal(parsed[1]?.readiness, "review");
  assert.equal(parsed[1]?.squarePath, "");
});

test("live import requires the confirmation phrase and a loopback API", async () => {
  const defaults = {
    manifestPath: "manifest.csv",
    root: repoRoot,
    progressPath: join(tmpdir(), "progress.json"),
  };
  const dryRun = parseImportArgs([], defaults);
  assert.equal(dryRun.ok && dryRun.options.mode, "dry-run");
  const missing = parseImportArgs(["--execute"], defaults);
  assert.equal(missing.ok, false);
  const remote = await runImportCli(
    ["--base-url", "https://giftcard.udderlyridiculousfarmlife.com"],
    {},
  );
  assert.equal(remote.code, 2);
  assert.match(remote.stderr, /loopback/);
});

test("production writes need a separate confirmation and still refuse a remote host", async () => {
  const defaults = {
    manifestPath: "manifest.csv",
    root: repoRoot,
    progressPath: join(tmpdir(), "progress.json"),
  };
  const dryRun = parseImportArgs(["--target", "production"], defaults);
  assert.equal(dryRun.ok && dryRun.options.mode, "dry-run");
  assert.equal(dryRun.ok && dryRun.options.target, "production");
  const missing = parseImportArgs(
    ["--target", "production", "--execute", "--confirm", "IMPORT-UNPUBLISHED"],
    defaults,
  );
  assert.equal(missing.ok, false);
  const authorized = parseImportArgs(
    [
      "--target",
      "production",
      "--execute",
      "--confirm",
      "IMPORT-UNPUBLISHED",
      "--confirm-production",
      "IMPORT-PRODUCTION-UNPUBLISHED",
    ],
    defaults,
  );
  assert.equal(authorized.ok && authorized.options.mode, "execute");
  assert.equal(authorized.ok && authorized.options.target, "production");
  const remote = await runImportCli(
    ["--target", "production", "--base-url", "https://giftcard.udderlyridiculousfarmlife.com"],
    {},
  );
  assert.equal(remote.code, 2);
  assert.match(remote.stderr, /loopback/);
});

test("a bad photograph blocks every write", async () => {
  const root = mkdtempSync(join(tmpdir(), "naming-import-"));
  const square = join(root, "square.jpg");
  writeFileSync(square, Buffer.from("not-a-jpeg"));
  writeFileSync(join(root, "original.jpg"), jpeg());
  const manifest = writeManifest(root, [
    row("Gate", "A gate.", "$100", 10000, "original.jpg", "square.jpg", "ready"),
  ]);
  let created = 0;
  const report = await runInventoryImport({
    manifestPath: manifest,
    root,
    mode: "execute",
    api: fakeApi({
      async create() {
        created += 1;
        throw new Error("create should not be called");
      },
    }),
    progressPath: join(root, "progress.json"),
  });
  assert.equal(created, 0);
  assert.equal(report.failures.length > 0, true);
  assert.equal(report.photographs.invalid, 1);
  assert.equal(report.duplicatesChecked, false);
});

test("recovery attaches a missing photograph without creating another object", async () => {
  const fixture = fixtureFiles();
  const manifest = writeManifest(fixture.root, [
    row("Gate", "A gate.", "$100", 10000, "original.jpg", "square.jpg", "ready"),
  ]);
  const existing: ExistingObject = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Gate",
    description: "A gate.",
    photoUrl: null,
    priceCents: 10000,
    availability: "available",
    published: false,
  };
  const uploads: string[] = [];
  const report = await runInventoryImport({
    manifestPath: manifest,
    root: fixture.root,
    mode: "execute",
    api: fakeApi({
      async list() {
        return [existing];
      },
      async create() {
        throw new Error("create should not be called");
      },
      async uploadPhoto(id) {
        uploads.push(id);
        return { ...existing, photoUrl: `/photos/${id}.jpg` };
      },
    }),
    progressPath: join(fixture.root, "progress.json"),
  });
  assert.deepEqual(uploads, [existing.id]);
  assert.equal(report.rows[0]?.action, "attached");
  assert.equal(report.rows[0]?.objectId, existing.id);
  assert.equal(report.failures.length, 0);
});

test("claimed and protected objects are reported and not modified", async () => {
  const fixture = fixtureFiles();
  const manifest = writeManifest(fixture.root, [
    row("Test Naming Bucket", "Replacement.", "$100", 10000, "original.jpg", "square.jpg", "ready"),
    row("Pitchfork", "A fork.", "$100", 10000, "original.jpg", "square.jpg", "ready"),
  ]);
  const bucket: ExistingObject = {
    id: BUCKET_ID,
    name: "Test Naming Bucket",
    description: "Original test object.",
    photoUrl: null,
    priceCents: 2000,
    availability: "claimed",
    published: false,
  };
  const pitchfork: ExistingObject = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Pitchfork",
    description: "A fork.",
    photoUrl: null,
    priceCents: 10000,
    availability: "claimed",
    published: false,
  };
  let writes = 0;
  const report = await runInventoryImport({
    manifestPath: manifest,
    root: fixture.root,
    mode: "dry-run",
    api: fakeApi({
      async list() {
        return [bucket, pitchfork];
      },
      async create() {
        writes += 1;
        throw new Error("create should not be called");
      },
      async uploadPhoto() {
        writes += 1;
        throw new Error("upload should not be called");
      },
    }),
    progressPath: join(fixture.root, "progress.json"),
  });
  assert.equal(writes, 0);
  assert.deepEqual(
    report.rows.map((item) => item.action),
    ["protected", "protected"],
  );
  assert.equal(report.untouched.some((item) => item.id === BUCKET_ID), true);
});

test("the staff client sends only unpublished create fields", async () => {
  const bodies: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (request.url === "/inventory/session") {
        response.setHeader(
          "set-cookie",
          "naming_inventory=session-token; HttpOnly; Path=/inventory",
        );
        response.end(
          JSON.stringify({ csrfToken: "csrf-token", expiresAt: "2026-11-10T00:00:00.000Z" }),
        );
        return;
      }
      if (request.method === "GET" && request.url === "/inventory/objects") {
        response.end(JSON.stringify({ objects: [] }));
        return;
      }
      if (request.headers["content-type"] === "application/json") {
        bodies.push(`${request.method} ${request.url} ${body}`);
      }
      response.end(
        JSON.stringify({
          id: "33333333-3333-4333-8333-333333333333",
          name: "Gate",
          description: "A gate.",
          photoUrl:
            request.method === "POST" && request.url?.endsWith("/photo")
              ? "/photos/33333333-3333-4333-8333-333333333333.jpg"
              : null,
          priceCents: 10000,
          currency: "CAD",
          availability: "available",
          published: false,
        }),
      );
    });
  });
  const baseUrl = await listen(server);
  try {
    const fixture = fixtureFiles();
    const manifest = writeManifest(fixture.root, [
      row("Gate", "A gate.", "$100", 10000, "original.jpg", "square.jpg", "ready"),
    ]);
    const result = await runImportCli(
      [
        "--manifest",
        manifest,
        "--base-url",
        baseUrl,
        "--root",
        fixture.root,
        "--progress",
        join(fixture.root, "progress.json"),
        "--execute",
        "--confirm",
        "IMPORT-UNPUBLISHED",
      ],
      { NAMING_ADMIN_PASSWORD: PASSWORD },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(bodies.some((body) => body.includes("published")), false);
    assert.match(bodies[0] ?? "", /POST \/inventory\/objects \{"name":"Gate","description":"A gate.","priceCents":10000\}/);
    assert.equal(result.report?.rows[0]?.action, "created");
    assert.equal(JSON.stringify(result).includes(PASSWORD), false);
  } finally {
    await close(server);
  }
});

const databaseUrl = localNamingDatabaseUrl();
const hasManifest = exists(campaignManifest);
let app: NestExpressApplication | undefined;
let baseUrl = "";
let sqlClient: postgres.Sql | undefined;
let database: ReturnType<typeof drizzle> | undefined;

test("campaign manifest imports through the isolated inventory API", {
  skip: !databaseUrl || !hasManifest,
  timeout: 180_000,
}, async () => {
  assert.ok(databaseUrl);
  await ensureImportDatabase();
  sqlClient = postgres(databaseUrl, { max: 4, onnotice: () => {} });
  await sqlClient.unsafe("select current_database()").then((rows) => {
    assert.equal(rows[0]?.current_database, "naming_import");
  });
  await sqlClient.unsafe("drop table if exists naming_notice cascade");
  await sqlClient.unsafe("drop table if exists naming_name_revision cascade");
  await sqlClient.unsafe("drop table if exists naming_reservation cascade");
  await sqlClient.unsafe("drop table if exists naming_object cascade");
  await applySqlMigrations(sqlClient, NAMING_SCHEMA_MIGRATIONS);
  database = drizzle(sqlClient);
  const photoDir = mkdtempSync(join(tmpdir(), "naming-import-photos-"));
  const application = await NestFactory.create<NestExpressApplication>(
    inventoryModule(new DatabaseService(database as never, sqlClient), photoDir),
    { logger: false },
  );
  application.useBodyParser("json", { limit: "2mb" });
  await application.listen(0, "127.0.0.1");
  app = application;
  baseUrl = `http://127.0.0.1:${(application.getHttpServer().address() as AddressInfo).port}`;

  const reservationId = await seedClaimed({
    objectId: BUCKET_ID,
    name: "Test Naming Bucket",
    description: "Claimed test object.",
    priceAmount: 2000,
    submittedName: "Test Name",
  });
  const bucketBefore = await freezeClaim(BUCKET_ID);
  const manifestRows = parseManifest(readFileSync(campaignManifest, "utf8"));
  const progressPath = join(tmpdir(), `naming-import-${process.pid}.json`);
  const args = [
    "--manifest",
    campaignManifest,
    "--base-url",
    baseUrl,
    "--root",
    repoRoot,
    "--progress",
    progressPath,
  ];

  const dryRun = await runImportCli(args, { NAMING_ADMIN_PASSWORD: PASSWORD });
  assert.equal(dryRun.code, 0, dryRun.stderr);
  assert.equal(dryRun.report?.objects, 74);
  assert.equal(dryRun.report?.ready, 74);
  assert.equal(dryRun.report?.duplicatesChecked, true);
  assert.equal(dryRun.report?.photographs.validated, 74);
  assert.equal(dryRun.report?.photographs.invalid, 0);
  assert.deepEqual(dryRun.report?.byTier, {
    $100: { ready: 32, review: 0, invalid: 0 },
    $250: { ready: 32, review: 0, invalid: 0 },
    $500: { ready: 8, review: 0, invalid: 0 },
    "$1,000": { ready: 2, review: 0, invalid: 0 },
  });
  assert.deepEqual(dryRun.report?.skipped, []);
  assert.equal(dryRun.report?.rows.filter((item) => item.action === "would-create").length, 74);
  assert.equal(dryRun.report?.untouched.some((item) => item.id === BUCKET_ID && item.availability === "claimed"), true);
  assert.equal(await countObjects(), 1);

  const refused = await runImportCli([...args, "--execute"], { NAMING_ADMIN_PASSWORD: PASSWORD });
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /IMPORT-UNPUBLISHED/);
  assert.equal(await countObjects(), 1);

  const sample = await runImportCli(
    [...args, "--limit", "2", "--execute", "--confirm", "IMPORT-UNPUBLISHED"],
    { NAMING_ADMIN_PASSWORD: PASSWORD },
  );
  assert.equal(sample.code, 0, sample.stderr);
  assert.deepEqual(
    sample.report?.rows.filter((item) => item.action === "created").map((item) => item.name),
    ["Aluminum Alpaca Catch Pen Gate", "Barrel"],
  );
  assert.equal(sample.report?.rows.filter((item) => item.action === "deferred").length, 72);
  assert.equal(await countObjects(), 3);
  for (const name of ["Aluminum Alpaca Catch Pen Gate", "Barrel"]) {
    await assertImported(name, manifestRows);
  }
  assert.equal(await freezeClaim(BUCKET_ID), bucketBefore);

  const rerun = await runImportCli(
    [...args, "--limit", "2", "--execute", "--confirm", "IMPORT-UNPUBLISHED"],
    { NAMING_ADMIN_PASSWORD: PASSWORD },
  );
  assert.equal(rerun.code, 0, rerun.stderr);
  assert.equal(rerun.report?.rows.filter((item) => item.action === "created").length, 0);
  assert.deepEqual(
    rerun.report?.duplicates.map((item) => item.result).sort(),
    ["complete", "complete"],
  );
  assert.equal(await countObjects(), 3);

  const third = manifestRows.filter((item) => item.readiness === "ready")[2];
  assert.ok(third);
  const thirdManifest = writeManifest(tmpdir(), [third]);
  const api = await connectStaffInventory(baseUrl, PASSWORD);
  let interrupted = false;
  const flaky: InventoryApi = {
    ...api,
    async uploadPhoto(id, bytes) {
      if (!interrupted) {
        interrupted = true;
        throw new Error("interrupted before photograph upload");
      }
      return api.uploadPhoto(id, bytes);
    },
  };
  const stopped = await runInventoryImport({
    manifestPath: thirdManifest,
    root: repoRoot,
    mode: "execute",
    api: flaky,
    progressPath,
  });
  assert.equal(stopped.failures.length, 1);
  assert.match(stopped.failures[0] ?? "", /interrupted before photograph upload/);
  assert.equal(stopped.rows[0]?.action, "created-without-photograph");
  const partialId = stopped.rows[0]?.objectId ?? "";
  const partial = await objectByName(third.name);
  assert.equal(partial.length, 1);
  assert.equal(partial[0]?.id, partialId);
  assert.equal(partial[0]?.photoUrl, null);
  assert.equal(partial[0]?.publishedAt, null);

  const recovered = await runInventoryImport({
    manifestPath: thirdManifest,
    root: repoRoot,
    mode: "execute",
    api,
    progressPath,
  });
  assert.equal(recovered.failures.length, 0);
  assert.equal(recovered.rows[0]?.action, "attached");
  assert.equal(recovered.rows[0]?.objectId, partialId);
  assert.equal((await objectByName(third.name)).length, 1);
  await assertImported(third.name, manifestRows);
  const progress = readFileSync(progressPath, "utf8");
  assert.equal(progress.includes(PASSWORD), false);
  assert.equal(progress.includes(partialId), true);

  const pitchfork = manifestRows.find((item) => item.name === "Pitchfork");
  assert.ok(pitchfork);
  const pitchforkReservation = await seedClaimed({
    objectId: randomUUID(),
    name: "Pitchfork",
    description: pitchfork.description,
    priceAmount: pitchfork.priceCents,
    submittedName: null,
  });
  const pitchforkBefore = await freezeClaim(pitchforkReservation.objectId);
  const pitchforkManifest = writeManifest(tmpdir(), [pitchfork]);
  const preserved = await runInventoryImport({
    manifestPath: pitchforkManifest,
    root: repoRoot,
    mode: "execute",
    api,
    progressPath,
  });
  assert.equal(preserved.rows[0]?.action, "protected");
  assert.equal(preserved.failures.length, 0);
  assert.equal(await freezeClaim(pitchforkReservation.objectId), pitchforkBefore);
  assert.equal((await objectByName("Pitchfork")).length, 1);

  const bucketManifest = writeManifest(tmpdir(), [
    row(
      "Test Naming Bucket",
      "This replacement must not be written.",
      "$100",
      10000,
      "assets/gift-card-campaign/originals/$100/Barrel.JPEG",
      "assets/gift-card-campaign/square/$100/barrel.jpg",
      "ready",
    ),
  ]);
  const bucketAttempt = await runInventoryImport({
    manifestPath: bucketManifest,
    root: repoRoot,
    mode: "execute",
    api,
    progressPath,
  });
  assert.equal(bucketAttempt.rows[0]?.action, "protected");
  assert.equal(await freezeClaim(BUCKET_ID), bucketBefore);
  assert.equal(await countObjects(), 5);
  assert.equal(reservationId.reservationId.length > 0, true);

  const listed = await api.list();
  const barrel = listed.find((item) => item.name === "Barrel");
  assert.ok(barrel?.photoUrl);
  assert.equal(barrel.published, false);
  const staffPhoto = await api.readStaffPhoto(barrel.photoUrl);
  assert.equal(staffPhoto.status, 200);
  assert.equal(staffPhoto.bytes[0], 0xff);
  assert.equal(await api.readPublicPhoto(barrel.photoUrl), 404);
  rmSync(photoDir, { recursive: true, force: true });
});

after(async () => {
  await app?.close();
});

function inventoryModule(databaseService: DatabaseService, photoDir: string): new () => NestModule {
  @Module({
    controllers: [NamingInventoryController, NamingPhotoController],
    providers: [
      NamingObjectService,
      NamingRateLimiter,
      InventorySessions,
      { provide: DatabaseService, useValue: databaseService },
      {
        provide: EnvService,
        useValue: {
          namingAdmin: { password: PASSWORD, sessionSecret: SESSION_SECRET },
          namingPhotoDir: photoDir,
          namingCampaignEnabled: false,
        },
      },
      {
        provide: NamingStaffService,
        useValue: {
          async view() {
            return undefined;
          },
          async correct() {
            return { outcome: "not_found" };
          },
          async resend() {
            return { outcome: "not_found" };
          },
        },
      },
    ],
  })
  class IsolatedInventoryModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      applyInventoryPhotoParser(consumer);
    }
  }
  return IsolatedInventoryModule;
}

async function seedClaimed(input: {
  objectId: string;
  name: string;
  description: string;
  priceAmount: number;
  submittedName: string | null;
}): Promise<{ objectId: string; reservationId: string }> {
  assert.ok(database);
  const now = new Date("2026-11-03T00:00:00.000Z");
  await database.insert(namingObjects).values({
    id: input.objectId,
    name: input.name,
    description: input.description,
    photoUrl: null,
    priceAmount: input.priceAmount,
    currency: "CAD",
    publishedAt: null,
    status: "available",
  });
  const reservationId = randomUUID();
  await database.insert(namingReservations).values({
    id: reservationId,
    objectId: input.objectId,
    checkoutRef: `ref-${reservationId}`,
    namingTokenHash: `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`,
    priceAmount: input.priceAmount,
    currency: "CAD",
    status: "claimed",
    claimedAt: now,
    fareharborBookingUuid: randomUUID(),
    paidAmount: input.priceAmount,
    adminResolutionRequired: false,
    ...(input.submittedName
      ? { submittedName: input.submittedName, namedAt: now }
      : {}),
  });
  await database
    .update(namingObjects)
    .set({ status: "claimed", claimedReservationId: reservationId })
    .where(eq(namingObjects.id, input.objectId));
  return { objectId: input.objectId, reservationId };
}

async function assertImported(name: string, manifestRows: ManifestRow[]): Promise<void> {
  const expected = manifestRows.find((item) => item.name === name);
  assert.ok(expected);
  const found = await objectByName(name);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.description, expected.description);
  assert.equal(found[0]?.priceAmount, expected.priceCents);
  assert.equal(found[0]?.publishedAt, null);
  assert.equal(found[0]?.status, "available");
  assert.equal(found[0]?.claimedReservationId, null);
  assert.match(found[0]?.photoUrl ?? "", /^\/photos\/[0-9a-f-]{36}\.jpg$/);
}

async function objectByName(name: string) {
  assert.ok(database);
  return database.select().from(namingObjects).where(eq(namingObjects.name, name));
}

async function countObjects(): Promise<number> {
  assert.ok(database);
  const rows = await database.select({ id: namingObjects.id }).from(namingObjects);
  return rows.length;
}

async function freezeClaim(objectId: string): Promise<string> {
  assert.ok(database);
  const [object] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, objectId));
  const [reservation] = await database
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.objectId, objectId));
  return JSON.stringify({ object, reservation }, (_key, value: unknown) =>
    value instanceof Date ? value.toISOString() : value,
  );
}

function row(
  name: string,
  description: string,
  tier: string,
  priceCents: number,
  originalPath: string,
  squarePath: string,
  readiness: string,
): ManifestRow {
  return {
    line: 2,
    name,
    description,
    tier,
    priceCents,
    originalPath,
    squarePath,
    processingStatus: "generated",
    notes: "",
    readiness,
  };
}

function writeManifest(root: string, rows: ManifestRow[]): string {
  const lines = [
    "object_name,description,price_tier,price_cad_cents,original_photograph_path,square_photograph_path,image_processing_status,matching_or_validation_notes,import_readiness",
    ...rows.map((item) =>
      [
        item.name,
        item.description,
        item.tier,
        String(item.priceCents),
        item.originalPath,
        item.squarePath,
        item.processingStatus,
        item.notes,
        item.readiness,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  const path = join(root, `manifest-${randomUUID()}.csv`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }
  return value;
}

function jpeg(): Buffer {
  const bytes = Buffer.alloc(32);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return bytes;
}

function fixtureFiles(): { root: string } {
  const root = mkdtempSync(join(tmpdir(), "naming-import-"));
  writeFileSync(join(root, "original.jpg"), jpeg());
  writeFileSync(join(root, "square.jpg"), jpeg());
  return { root };
}

function fakeApi(overrides: Partial<InventoryApi>): InventoryApi {
  return {
    async list() {
      return [];
    },
    async create() {
      throw new Error("create should not be called");
    },
    async uploadPhoto() {
      throw new Error("upload should not be called");
    },
    async readStaffPhoto() {
      return { status: 404, bytes: Buffer.alloc(0) };
    },
    async readPublicPhoto() {
      return 404;
    },
    ...overrides,
  };
}

function localNamingDatabaseUrl(): string | undefined {
  const url = process.env.NAMING_TEST_DATABASE_URL;
  if (!url) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("NAMING_TEST_DATABASE_URL must point at localhost");
  }
  if (parsed.pathname !== "/naming") {
    throw new Error("NAMING_TEST_DATABASE_URL must use the naming database");
  }
  parsed.pathname = "/naming_import";
  return parsed.toString();
}

async function ensureImportDatabase(): Promise<void> {
  const adminUrl = process.env.NAMING_TEST_DATABASE_URL;
  if (!adminUrl) {
    return;
  }
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    const existing = await admin<{ datname: string }[]>`
      select datname from pg_database where datname = 'naming_import'
    `;
    if (existing.length === 0) {
      await admin.unsafe("create database naming_import");
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
}

function exists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function listen(server: Server): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolvePromise(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}
