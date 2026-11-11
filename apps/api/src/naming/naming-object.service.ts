import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { namingObjects } from "../database/schema/naming";
import type {
  NamingObjectAddCommand,
  NamingObjectEditCommand,
} from "./naming-object.command";

export type NamingObjectRecord = {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  priceAmount: number;
  currency: string;
  publishedAt: Date | null;
  isTest: boolean;
  status: string;
};

export type NamingObjectWriteResult =
  | { outcome: "created" | "updated"; object: NamingObjectRecord }
  | { outcome: "not_found" }
  | { outcome: "price_locked" }
  | { outcome: "test_object" };

@Injectable()
export class NamingObjectService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async create(command: NamingObjectAddCommand): Promise<NamingObjectRecord> {
    const [row] = await this.database.db
      .insert(namingObjects)
      .values({
        name: command.name,
        description: command.description,
        photoUrl: command.photoUrl,
        priceAmount: command.priceAmount,
        currency: "CAD",
        publishedAt: command.isTest === true || !command.publish ? null : new Date(),
        isTest: command.isTest === true,
        status: "available",
      })
      .returning();
    return toRecord(row);
  }

  async list(): Promise<NamingObjectRecord[]> {
    const rows = await this.database.db
      .select()
      .from(namingObjects)
      .orderBy(namingObjects.createdAt);
    return rows.map(toRecord);
  }

  async update(command: NamingObjectEditCommand): Promise<NamingObjectWriteResult> {
    const [existing] = await this.database.db
      .select()
      .from(namingObjects)
      .where(eq(namingObjects.id, command.id))
      .limit(1);
    if (!existing) {
      return { outcome: "not_found" };
    }
    if (
      command.priceAmount !== undefined &&
      existing.status !== "available"
    ) {
      return { outcome: "price_locked" };
    }
    if (command.publish === true && existing.isTest) {
      return { outcome: "test_object" };
    }

    const [row] = await this.database.db
      .update(namingObjects)
      .set({
        ...(command.name !== undefined ? { name: command.name } : {}),
        ...(command.description !== undefined
          ? { description: command.description }
          : {}),
        ...(command.priceAmount !== undefined
          ? { priceAmount: command.priceAmount }
          : {}),
        ...(command.photoUrl !== undefined ? { photoUrl: command.photoUrl } : {}),
        ...(command.publish === undefined
          ? {}
          : { publishedAt: command.publish ? new Date() : null }),
        updatedAt: new Date(),
      })
      .where(eq(namingObjects.id, command.id))
      .returning();
    return { outcome: "updated", object: toRecord(row) };
  }
}

function toRecord(row: {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  priceAmount: number;
  currency: string;
  publishedAt: Date | null;
  isTest: boolean;
  status: string;
}): NamingObjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    photoUrl: row.photoUrl,
    priceAmount: row.priceAmount,
    currency: row.currency,
    publishedAt: row.publishedAt,
    isTest: row.isTest,
    status: row.status,
  };
}
