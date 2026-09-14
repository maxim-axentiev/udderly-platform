import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { FareharborWebhookService } from "./fareharbor-webhook.service";

@Controller("webhooks/fareharbor")
export class FareharborWebhookController {
  constructor(
    @Inject(FareharborWebhookService)
    private readonly fareharbor: FareharborWebhookService,
  ) {}

  @Post(":secret")
  @HttpCode(200)
  async receive(@Param("secret") secret: string, @Body() body: unknown) {
    if (!this.fareharbor.configured) {
      throw new NotFoundException();
    }

    this.fareharbor.assertValidSecret(secret);
    await this.fareharbor.ingest(body);
    return { ok: true };
  }
}

@Controller("integrations/fareharbor")
export class FareharborStatusController {
  constructor(
    @Inject(FareharborWebhookService)
    private readonly fareharbor: FareharborWebhookService,
  ) {}

  @Get("status")
  @Header("Cache-Control", "no-store")
  status() {
    return this.fareharbor.getSafeStatus();
  }
}
