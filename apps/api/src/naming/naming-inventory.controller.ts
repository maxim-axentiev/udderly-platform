import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from "@nestjs/common";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import type { Request, Response } from "express";
import { z } from "zod";
import { EnvService } from "../config/env.service";
import type { NamingObjectRecord } from "./naming-object.service";
import { NamingObjectService } from "./naming-object.service";
import {
  CERTIFICATE_RESEND_CONFIRMATION,
  NamingStaffService,
} from "./naming-staff.service";
import {
  discardStagedPhoto,
  placeNewPhoto,
  removeOtherPhotoExtensions,
  replaceExistingPhoto,
  resolveStoredPhoto,
  stagePhoto,
} from "./naming-inventory.photo";
import { InventorySessions } from "./naming-inventory.sessions";
import { NamingRateLimiter } from "./naming-rate-limit";
import {
  INVENTORY_COOKIE,
  INVENTORY_CSRF_HEADER,
  INVENTORY_SESSION_MS,
  createCsrfToken,
  inventorySessionCookie,
  openInventorySession,
  passwordsMatch,
  readCookie,
  signInventorySession,
  tokensMatch,
} from "./naming-inventory.session";

const objectIdSchema = z.string().uuid();
const priceSchema = z.number().int().nonnegative().max(10_000_000);
const loginSchema = z.object({ password: z.string().min(1).max(200) }).strict();
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(""),
    priceCents: priceSchema,
  })
  .strict();
const correctionSchema = z.object({ name: z.string().max(200) }).strict();
const resendSchema = z
  .object({ confirm: z.literal(CERTIFICATE_RESEND_CONFIRMATION) })
  .strict();
const editSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    priceCents: priceSchema.optional(),
    published: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.priceCents !== undefined ||
      value.published !== undefined,
    { message: "nothing" },
  );

type InventoryObject = {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  priceCents: number;
  currency: string;
  availability: string;
  published: boolean;
};

@Controller("inventory")
export class NamingInventoryController {
  constructor(
    @Inject(NamingObjectService) private readonly objects: NamingObjectService,
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(NamingRateLimiter) private readonly limiter: NamingRateLimiter,
    @Inject(InventorySessions) private readonly sessions: InventorySessions,
    @Inject(NamingStaffService) private readonly staff: NamingStaffService,
  ) {}

  @Post("session")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const admin = this.configured();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Enter the staff password.");
    }
    const address = clientAddress(request);
    const key = `inventory-login:${address}`;
    if (this.limiter.blocked(key)) {
      throw new HttpException(
        "Too many sign-in attempts. Try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!passwordsMatch(parsed.data.password, admin.password)) {
      this.limiter.consume(key);
      throw new UnauthorizedException("That password was not accepted.");
    }
    const expiresAt = Date.now() + INVENTORY_SESSION_MS;
    const csrf = createCsrfToken();
    const sid = this.sessions.start(expiresAt, csrf);
    response.appendHeader(
      "Set-Cookie",
      inventorySessionCookie(
        signInventorySession(admin.sessionSecret, expiresAt, csrf, sid),
        INVENTORY_SESSION_MS / 1000,
      ),
    );
    return { csrfToken: csrf, expiresAt: new Date(expiresAt).toISOString() };
  }

  @Get("session")
  @Header("Cache-Control", "no-store")
  restore(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = this.requireSession(request);
    const admin = this.configured();
    const csrf = createCsrfToken();
    if (!this.sessions.replaceCsrf(session.sid, csrf, Date.now())) {
      throw new UnauthorizedException("Sign in to manage inventory.");
    }
    const remainingSeconds = Math.max(
      1,
      Math.floor((session.exp - Date.now()) / 1000),
    );
    response.appendHeader(
      "Set-Cookie",
      inventorySessionCookie(
        signInventorySession(admin.sessionSecret, session.exp, csrf, session.sid),
        remainingSeconds,
      ),
    );
    return { csrfToken: csrf, expiresAt: new Date(session.exp).toISOString() };
  }

  @Post("session/logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("Cache-Control", "no-store")
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = this.requireSession(request);
    this.sessions.end(session.sid);
    response.appendHeader("Set-Cookie", inventorySessionCookie("", 0));
  }

  @Get("objects/:id/naming")
  @Header("Cache-Control", "no-store")
  async naming(@Param("id") id: string, @Req() request: Request) {
    this.requireSession(request);
    if (!objectIdSchema.safeParse(id).success) {
      throw new NotFoundException();
    }
    const view = await this.staff.view(id);
    if (!view) {
      throw new NotFoundException();
    }
    return view;
  }

  @Post("objects/:id/naming/correction")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async correctName(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    this.requireSession(request);
    if (!objectIdSchema.safeParse(id).success) {
      throw new NotFoundException();
    }
    const parsed = correctionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Enter a name.");
    }
    const result = await this.staff.correct(id, parsed.data.name);
    if (result.outcome === "invalid_name") {
      throw new BadRequestException(
        "Enter a name of 40 characters or fewer, without line breaks.",
      );
    }
    if (result.outcome === "not_found") {
      throw new NotFoundException();
    }
    return { submittedName: result.submittedName };
  }

  @Post("objects/:id/naming/resend")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async resendCertificate(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    this.requireSession(request);
    if (!objectIdSchema.safeParse(id).success) {
      throw new NotFoundException();
    }
    const parsed = resendSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Confirm the certificate resend.");
    }
    const result = await this.staff.resend(id);
    if (result.outcome === "not_found") {
      throw new NotFoundException();
    }
    if (result.outcome === "in_progress") {
      throw new ConflictException("A certificate resend is already in progress.");
    }
    if (result.outcome === "sent") {
      return { resendStatus: "sent" };
    }
    return { resendStatus: "failed" };
  }

  @Get("objects")
  @Header("Cache-Control", "no-store")
  async list(@Req() request: Request) {
    this.requireSession(request);
    const objects = await this.objects.list();
    return { objects: objects.map(toInventoryObject) };
  }

  @Post("objects")
  @HttpCode(HttpStatus.CREATED)
  @Header("Cache-Control", "no-store")
  async create(@Body() body: unknown, @Req() request: Request) {
    this.requireSession(request);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Enter a name and a CAD price.");
    }
    const created = await this.objects.create({
      action: "add",
      name: parsed.data.name,
      description: parsed.data.description,
      priceAmount: parsed.data.priceCents,
      photoUrl: null,
      publish: false,
    });
    return toInventoryObject(created);
  }

  @Patch("objects/:id")
  @Header("Cache-Control", "no-store")
  async edit(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    this.requireSession(request);
    if (!objectIdSchema.safeParse(id).success) {
      throw new NotFoundException();
    }
    const parsed = editSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Enter the fields to change.");
    }
    const current = await this.findObject(id);
    if (!current) {
      throw new NotFoundException();
    }
    if (parsed.data.published === true && current.status !== "available") {
      throw new ConflictException(
        "Publish this object only while it is available.",
      );
    }
    const result = await this.objects.update({
      action: "edit",
      id,
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      ...(parsed.data.priceCents !== undefined
        ? { priceAmount: parsed.data.priceCents }
        : {}),
      ...(parsed.data.published !== undefined
        ? { publish: parsed.data.published }
        : {}),
    });
    if (result.outcome === "not_found") {
      throw new NotFoundException();
    }
    if (result.outcome === "price_locked") {
      throw new ConflictException(
        "The price cannot change while this object is held or claimed.",
      );
    }
    return toInventoryObject(result.object);
  }

  @Post("objects/:id/photo")
  @Header("Cache-Control", "no-store")
  async uploadPhoto(@Param("id") id: string, @Req() request: Request) {
    this.requireSession(request);
    if (!objectIdSchema.safeParse(id).success) {
      throw new NotFoundException();
    }
    const current = await this.findObject(id);
    if (!current) {
      throw new NotFoundException();
    }
    const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const staged = await stagePhoto(this.env.namingPhotoDir, id, bytes);
    if (!staged) {
      throw new BadRequestException("Use a JPEG, PNG, or WebP photograph.");
    }
    const sameFile = current.photoUrl === staged.photoUrl;
    let result;
    try {
      if (!sameFile) {
        await placeNewPhoto(staged, this.env.namingPhotoDir);
      }
      result = await this.objects.update({
        action: "edit",
        id,
        photoUrl: staged.photoUrl,
      });
    } catch (error) {
      await discardStagedPhoto(staged, this.env.namingPhotoDir, !sameFile);
      throw error;
    }
    if (result.outcome !== "updated") {
      await discardStagedPhoto(staged, this.env.namingPhotoDir, !sameFile);
      throw new NotFoundException();
    }
    if (sameFile) {
      await replaceExistingPhoto(staged, this.env.namingPhotoDir);
    } else {
      await discardStagedPhoto(staged, this.env.namingPhotoDir, false);
      const extension = staged.fileName.slice(staged.fileName.lastIndexOf(".") + 1);
      if (extension === "jpg" || extension === "png" || extension === "webp") {
        await removeOtherPhotoExtensions(this.env.namingPhotoDir, id, extension);
      }
    }
    return toInventoryObject(result.object);
  }

  @Get("photos/:file")
  @Header("X-Content-Type-Options", "nosniff")
  @Header("Cache-Control", "private, no-store")
  async staffPhoto(
    @Param("file") file: string,
    @Req() request: Request,
  ): Promise<StreamableFile> {
    this.requireSession(request);
    return this.openPhoto(file, false);
  }

  private configured(): { password: string; sessionSecret: string } {
    const admin = this.env.namingAdmin;
    if (!admin) {
      throw new NotFoundException();
    }
    return admin;
  }

  private requireSession(request: Request): { csrf: string; exp: number; sid: string } {
    const admin = this.configured();
    const token = readCookie(request.headers.cookie, INVENTORY_COOKIE);
    const now = Date.now();
    const session = token
      ? openInventorySession(admin.sessionSecret, token, now)
      : undefined;
    const active = session ? this.sessions.current(session.sid, now) : undefined;
    if (!session || !active || !tokensMatch(session.csrf, active.csrf)) {
      throw new UnauthorizedException("Sign in to manage inventory.");
    }
    if (request.method !== "GET") {
      const provided = headerValue(request, INVENTORY_CSRF_HEADER);
      if (!provided || !tokensMatch(provided, active.csrf)) {
        throw new ForbiddenException("Refresh this page and sign in again.");
      }
    }
    return session;
  }

  private async openPhoto(
    file: string,
    publishedOnly: boolean,
  ): Promise<StreamableFile> {
    const stored = resolveStoredPhoto(this.env.namingPhotoDir, file);
    const objectId = stored ? file.slice(0, 36).toLowerCase() : "";
    const object = objectId ? await this.findObject(objectId) : undefined;
    const expected = `/photos/${file.toLowerCase()}`;
    if (
      !stored ||
      !object ||
      object.photoUrl?.toLowerCase() !== expected ||
      (publishedOnly && object.publishedAt === null)
    ) {
      throw new NotFoundException();
    }
    try {
      await access(stored.path);
    } catch {
      throw new NotFoundException();
    }
    return new StreamableFile(createReadStream(stored.path), {
      type: stored.contentType,
    });
  }

  private async findObject(id: string): Promise<NamingObjectRecord | undefined> {
    const objects = await this.objects.list();
    return objects.find((object) => object.id === id);
  }
}

@Controller("photos")
export class NamingPhotoController {
  constructor(
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(NamingObjectService) private readonly objects: NamingObjectService,
  ) {}

  @Get(":file")
  @Header("X-Content-Type-Options", "nosniff")
  @Header("Cache-Control", "no-cache")
  async photo(@Param("file") file: string): Promise<StreamableFile> {
    const stored = resolveStoredPhoto(this.env.namingPhotoDir, file);
    const objectId = stored ? file.slice(0, 36).toLowerCase() : "";
    const objects = objectId ? await this.objects.list() : [];
    const object = objects.find((item) => item.id === objectId);
    const expected = `/photos/${file.toLowerCase()}`;
    if (
      !stored ||
      !object?.publishedAt ||
      object.photoUrl?.toLowerCase() !== expected
    ) {
      throw new NotFoundException();
    }
    try {
      await access(stored.path);
    } catch {
      throw new NotFoundException();
    }
    return new StreamableFile(createReadStream(stored.path), {
      type: stored.contentType,
    });
  }
}

function toInventoryObject(object: NamingObjectRecord): InventoryObject {
  return {
    id: object.id,
    name: object.name,
    description: object.description,
    photoUrl: object.photoUrl,
    priceCents: object.priceAmount,
    currency: object.currency,
    availability: object.status,
    published: object.publishedAt !== null,
  };
}

function clientAddress(request: Request): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}
