import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import {
  experienceSourceMappings,
  experiences,
} from "../../database/schema/experiences";
import { FAREHARBOR_PROVIDER } from "./fareharbor.crypto";
import { FAREHARBOR_ITEM_OBJECT_TYPE } from "./fareharbor.constants";

const EXPERIENCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FareharborExperienceMapCommand = {
  itemId: string;
  name?: string;
  experienceId?: string;
};

export type FareharborExperienceMapResult =
  | {
      outcome: "created";
      itemId: string;
      experienceId: string;
      createdExperience: boolean;
    }
  | {
      outcome: "unchanged";
      itemId: string;
      experienceId: string;
    }
  | {
      outcome: "conflict";
      itemId: string;
      mappedExperienceId: string;
    }
  | {
      outcome: "ambiguous_name";
      name: string;
      matchCount: number;
    }
  | { outcome: "experience_not_found"; experienceId: string }
  | { outcome: "invalid"; reason: "args" | "item_id" | "experience_id" };

@Injectable()
export class FareharborExperienceMapService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async mapItem(
    command: FareharborExperienceMapCommand,
  ): Promise<FareharborExperienceMapResult> {
    const itemId = command.itemId.trim();
    if (!itemId) {
      return { outcome: "invalid", reason: "item_id" };
    }

    const name = command.name?.trim();
    const experienceId = command.experienceId?.trim();

    if ((name && experienceId) || (!name && !experienceId)) {
      return { outcome: "invalid", reason: "args" };
    }

    if (experienceId && !EXPERIENCE_ID_PATTERN.test(experienceId)) {
      return { outcome: "invalid", reason: "experience_id" };
    }

    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`fh-item-map-${itemId}`}, 0))`,
      );

      const existingMapping = await this.findItemMapping(tx, itemId);

      if (experienceId) {
        const [experience] = await tx
          .select({ id: experiences.id })
          .from(experiences)
          .where(eq(experiences.id, experienceId))
          .limit(1);
        if (!experience) {
          return {
            outcome: "experience_not_found" as const,
            experienceId,
          };
        }

        return this.upsertMapping(tx, {
          itemId,
          experienceId,
          existingMapping,
          createdExperience: false,
        });
      }

      const matches = await tx
        .select({ id: experiences.id })
        .from(experiences)
        .where(eq(experiences.name, name as string));

      if (matches.length > 1) {
        return {
          outcome: "ambiguous_name" as const,
          name: name as string,
          matchCount: matches.length,
        };
      }

      if (matches[0]) {
        return this.upsertMapping(tx, {
          itemId,
          experienceId: matches[0].id,
          existingMapping,
          createdExperience: false,
        });
      }

      if (existingMapping) {
        return {
          outcome: "conflict" as const,
          itemId,
          mappedExperienceId: existingMapping.experienceId,
        };
      }

      const inserted = await tx
        .insert(experiences)
        .values({
          name: name as string,
          status: "active",
        })
        .returning({ id: experiences.id });
      const createdId = inserted[0]?.id;
      if (!createdId) {
        throw new Error("experience_insert_failed");
      }

      return this.upsertMapping(tx, {
        itemId,
        experienceId: createdId,
        existingMapping,
        createdExperience: true,
      });
    });
  }

  private async findItemMapping(
    tx: Pick<DatabaseService["db"], "select">,
    itemId: string,
  ): Promise<{ id: string; experienceId: string } | undefined> {
    const rows = await tx
      .select({
        id: experienceSourceMappings.id,
        experienceId: experienceSourceMappings.experienceId,
      })
      .from(experienceSourceMappings)
      .where(
        and(
          eq(experienceSourceMappings.provider, FAREHARBOR_PROVIDER),
          eq(
            experienceSourceMappings.providerObjectType,
            FAREHARBOR_ITEM_OBJECT_TYPE,
          ),
          eq(experienceSourceMappings.externalId, itemId),
        ),
      )
      .limit(1);

    return rows[0];
  }

  private async upsertMapping(
    tx: Pick<DatabaseService["db"], "insert" | "update">,
    input: {
      itemId: string;
      experienceId: string;
      existingMapping?: {
        id: string;
        experienceId: string;
      };
      createdExperience: boolean;
    },
  ): Promise<FareharborExperienceMapResult> {
    if (input.existingMapping) {
      if (input.existingMapping.experienceId !== input.experienceId) {
        return {
          outcome: "conflict",
          itemId: input.itemId,
          mappedExperienceId: input.existingMapping.experienceId,
        };
      }

      return {
        outcome: "unchanged",
        itemId: input.itemId,
        experienceId: input.experienceId,
      };
    }

    await tx.insert(experienceSourceMappings).values({
      experienceId: input.experienceId,
      provider: FAREHARBOR_PROVIDER,
      providerObjectType: FAREHARBOR_ITEM_OBJECT_TYPE,
      externalId: input.itemId,
    });

    return {
      outcome: "created",
      itemId: input.itemId,
      experienceId: input.experienceId,
      createdExperience: input.createdExperience,
    };
  }
}
