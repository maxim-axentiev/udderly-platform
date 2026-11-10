import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { EnvService } from "../config/env.service";
import {
  NAMING_CLOSED_MESSAGE,
  PURCHASE_CLOSED_MESSAGE,
} from "./naming-deadline";
import { NamingRateLimiter } from "./naming-rate-limit";
import { NamingPublicService } from "./naming-public.service";

const objectIdSchema = z.string().uuid();
const reserveSchema = z.object({ objectId: objectIdSchema }).strict();
const submitSchema = z.object({ name: z.string().max(200) }).strict();
const namingTokenPattern = /^[A-Za-z0-9_-]{43}$/;

@Controller("naming")
export class NamingPublicController {
  constructor(
    @Inject(NamingPublicService) private readonly naming: NamingPublicService,
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(NamingRateLimiter) private readonly limiter: NamingRateLimiter,
  ) {}

  @Get("objects")
  @Header("Cache-Control", "no-store")
  list() {
    this.assertEnabled();
    return this.naming.listPublished();
  }

  @Post("reservations")
  @HttpCode(HttpStatus.CREATED)
  @Header("Cache-Control", "no-store")
  async reserve(@Body() body: unknown, @Req() request: Request) {
    this.assertEnabled();
    this.consume(request, "reserve");
    const parsed = reserveSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Enter a valid object.");
    }
    const result = await this.naming.createReservation(parsed.data.objectId);
    if (result.outcome === "not_found" || result.outcome === "unpublished") {
      throw new NotFoundException();
    }
    if (result.outcome === "unavailable") {
      throw new ConflictException("This object is not available.");
    }
    if (result.outcome === "purchase_closed") {
      throw new ConflictException(PURCHASE_CLOSED_MESSAGE);
    }
    if (result.outcome === "checkout_unavailable") {
      throw new ConflictException("This object cannot be purchased right now.");
    }
    return {
      reservationId: result.reservationId,
      holdExpiresAt: result.holdExpiresAt.toISOString(),
      checkoutUrl: result.checkoutUrl,
    };
  }

  @Get("reservations/:reservationId")
  @Header("Cache-Control", "no-store")
  async reservation(@Param("reservationId") reservationId: string) {
    this.assertEnabled();
    if (!objectIdSchema.safeParse(reservationId).success) {
      throw new NotFoundException();
    }
    const status = await this.naming.reservationStatus(reservationId);
    if (!status) {
      throw new NotFoundException();
    }
    return status;
  }

  @Get("links/:token")
  @Header("Cache-Control", "no-store")
  async resolve(@Param("token") token: string) {
    this.assertEnabled();
    if (!namingTokenPattern.test(token)) {
      throw new NotFoundException();
    }
    const result = await this.naming.resolveLink(token);
    if (result.outcome !== "resolved") {
      throw new NotFoundException();
    }
    return {
      objectName: result.objectName,
      description: result.description,
      photoUrl: result.photoUrl,
      namingStatus: result.namingStatus,
      submittedName: result.submittedName,
      submissionOpen: result.submissionOpen,
    };
  }

  @Post("links/:token")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async submit(
    @Param("token") token: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    this.assertEnabled();
    this.consume(request, "submit");
    if (!namingTokenPattern.test(token)) {
      throw new NotFoundException();
    }
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Enter a name.");
    }
    const result = await this.naming.submitName(token, parsed.data.name);
    if (result.outcome === "invalid") {
      throw new NotFoundException();
    }
    if (result.outcome === "invalid_name") {
      throw new BadRequestException(
        "Enter a name using letters, numbers, and simple punctuation.",
      );
    }
    if (result.outcome === "already_named") {
      throw new ConflictException("This item already has a name.");
    }
    if (result.outcome === "payment_reversed") {
      throw new ConflictException("This naming link cannot accept a name.");
    }
    if (result.outcome === "deadline_closed") {
      throw new ConflictException(NAMING_CLOSED_MESSAGE);
    }
    return { submittedName: result.submittedName };
  }

  private assertEnabled(): void {
    if (!this.env.namingCampaignEnabled) {
      throw new NotFoundException();
    }
  }

  private consume(request: Request, action: "reserve" | "submit"): void {
    const address = request.ip || request.socket.remoteAddress || "unknown";
    if (!this.limiter.consume(`${action}:${address}`)) {
      throw new HttpException(
        "Too many requests. Try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
