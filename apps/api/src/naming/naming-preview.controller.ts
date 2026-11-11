import { access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Req,
  StreamableFile,
} from "@nestjs/common";
import type { Request } from "express";
import { EnvService } from "../config/env.service";
import { NamingObjectService } from "./naming-object.service";
import { resolveStoredPhoto } from "./naming-inventory.photo";
import {
  isPreviewCatalogObject,
  previewRequestAllowed,
  selectPreviewCatalog,
} from "./naming-preview";

@Controller("naming/preview")
export class NamingPreviewController {
  constructor(
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(NamingObjectService) private readonly objects: NamingObjectService,
  ) {}

  @Get("catalog")
  @Header("Cache-Control", "private, no-store")
  async catalog(@Req() request: Request) {
    this.assertPreview(request);
    const objects = await this.objects.list();
    return { objects: selectPreviewCatalog(objects) };
  }

  @Get("photos/:file")
  @Header("Cache-Control", "private, no-cache")
  @Header("X-Content-Type-Options", "nosniff")
  async photo(
    @Param("file") file: string,
    @Req() request: Request,
  ): Promise<StreamableFile> {
    this.assertPreview(request);
    const stored = resolveStoredPhoto(this.env.namingPhotoDir, file);
    const objects = stored ? await this.objects.list() : [];
    const expected = `/photos/${file.toLowerCase()}`;
    const object = objects.find(
      (item) =>
        isPreviewCatalogObject(item) &&
        item.photoUrl?.toLowerCase() === expected,
    );
    if (!stored || !object) {
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

  private assertPreview(request: Request): void {
    if (
      !previewRequestAllowed({
        previewMode: this.env.namingPreviewMode,
        nodeEnv: this.env.nodeEnv,
        host: request.headers.host,
      })
    ) {
      throw new NotFoundException();
    }
  }
}
