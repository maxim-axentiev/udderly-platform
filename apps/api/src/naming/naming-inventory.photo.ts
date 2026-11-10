import { randomBytes } from "node:crypto";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MiddlewareConsumer } from "@nestjs/common";
import { RequestMethod } from "@nestjs/common";
import express from "express";

export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;

const OBJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

const CONTENT_TYPES = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export type PhotoExtension = keyof typeof CONTENT_TYPES;

export type StagedPhoto = {
  tempPath: string;
  fileName: string;
  photoUrl: string;
};

export function detectPhoto(bytes: Buffer): PhotoExtension | undefined {
  if (bytes.length < 12 || bytes.length > PHOTO_MAX_BYTES) {
    return undefined;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return undefined;
}

export function photoContentType(fileName: string): string | undefined {
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "jpg" || extension === "png" || extension === "webp") {
    return CONTENT_TYPES[extension];
  }
  return undefined;
}

export function resolveStoredPhoto(
  directory: string,
  file: string,
): { path: string; contentType: string } | undefined {
  if (!PHOTO_FILE.test(file)) {
    return undefined;
  }
  const fileName = file.toLowerCase();
  const contentType = photoContentType(fileName);
  const root = resolve(directory);
  const path = resolve(root, fileName);
  if (path !== join(root, fileName)) {
    return undefined;
  }
  if (!contentType) {
    return undefined;
  }
  return { path, contentType };
}

export async function stagePhoto(
  directory: string,
  objectId: string,
  bytes: Buffer,
): Promise<StagedPhoto | undefined> {
  if (!OBJECT_ID.test(objectId)) {
    return undefined;
  }
  const extension = detectPhoto(bytes);
  if (!extension) {
    return undefined;
  }
  await mkdir(directory, { recursive: true });
  const fileName = `${objectId.toLowerCase()}.${extension}`;
  const tempPath = join(
    directory,
    `.${objectId.toLowerCase()}.${extension}.${randomBytes(8).toString("hex")}.tmp`,
  );
  await writeFile(tempPath, bytes, { flag: "wx" });
  return {
    tempPath,
    fileName,
    photoUrl: `/photos/${fileName}`,
  };
}

export async function placeNewPhoto(staged: StagedPhoto, directory: string): Promise<void> {
  await copyFile(staged.tempPath, join(directory, staged.fileName));
}

export async function replaceExistingPhoto(
  staged: StagedPhoto,
  directory: string,
): Promise<void> {
  await copyFile(staged.tempPath, join(directory, staged.fileName));
  await rm(staged.tempPath, { force: true });
}

export async function discardStagedPhoto(
  staged: StagedPhoto,
  directory: string,
  removeFinal: boolean,
): Promise<void> {
  await rm(staged.tempPath, { force: true });
  if (removeFinal) {
    await rm(join(directory, staged.fileName), { force: true });
  }
}

export async function removeOtherPhotoExtensions(
  directory: string,
  objectId: string,
  keep: PhotoExtension,
): Promise<void> {
  const id = objectId.toLowerCase();
  const extensions: PhotoExtension[] = ["jpg", "png", "webp"];
  await Promise.all(
    extensions
      .filter((extension) => extension !== keep)
      .map((extension) => rm(join(directory, `${id}.${extension}`), { force: true })),
  );
}

export function applyInventoryPhotoParser(consumer: MiddlewareConsumer): void {
  consumer.apply(photoBody).forRoutes({
    path: "inventory/objects/:id/photo",
    method: RequestMethod.POST,
  });
}

function photoBody(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
): void {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > PHOTO_MAX_BYTES) {
    response.status(413).json({
      message: "Photographs must be 3 MB or smaller.",
    });
    return;
  }
  express.raw({ type: () => true, limit: PHOTO_MAX_BYTES })(
    request,
    response,
    (error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 413
      ) {
        response.status(413).json({
          message: "Photographs must be 3 MB or smaller.",
        });
        return;
      }
      next(error);
    },
  );
}
