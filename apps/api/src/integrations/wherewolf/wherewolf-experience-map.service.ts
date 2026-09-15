import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import {
  experienceSourceMappings,
  experiences,
} from "../../database/schema/experiences";
import {
  WHEREWOLF_ACTIVITY_OBJECT_TYPE,
  WHEREWOLF_PROVIDER,
} from "./wherewolf.constants";

const EXPERIENCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WherewolfExperienceMapCommand = {
  activityId: string;
  name?: string;
  experienceId?: string;
};

export type WherewolfExperienceMapResult =
  | {
      outcome: "created";
      activityId: string;
      experienceId: string;
      createdExperience: boolean;
    }
  | {
      outcome: "unchanged";
      activityId: string;
      experienceId: string;
    }
  | {
      outcome: "conflict";
      activityId: string;
      mappedExperienceId: string;
    }
  | {
      outcome: "ambiguous_name";
      name: string;
      matchCount: number;
    }
  | { outcome: "experience_not_found"; experienceId: string }
  | { outcome: "invalid"; reason: "args" | "activity_id" | "experience_id" };

@Injectable()
export class WherewolfExperienceMapService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async mapActivity(
    command: WherewolfExperienceMapCommand,
  ): Promise<WherewolfExperienceMapResult> {
    const activityId = command.activityId.trim();
    if (!activityId) {
      return { outcome: "invalid", reason: "activity_id" };
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
        sql`select pg_advisory_xact_lock(hashtextextended(${`ww-activity-map-${activityId}`}, 0))`,
      );

      const existingMapping = await this.findActivityMapping(tx, activityId);

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
          activityId,
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
          activityId,
          experienceId: matches[0].id,
          existingMapping,
          createdExperience: false,
        });
      }

      if (existingMapping) {
        return {
          outcome: "conflict" as const,
          activityId,
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
        activityId,
        experienceId: createdId,
        existingMapping,
        createdExperience: true,
      });
    });
  }

  private async findActivityMapping(
    tx: Pick<DatabaseService["db"], "select">,
    activityId: string,
  ): Promise<{ id: string; experienceId: string } | undefined> {
    const rows = await tx
      .select({
        id: experienceSourceMappings.id,
        experienceId: experienceSourceMappings.experienceId,
      })
      .from(experienceSourceMappings)
      .where(
        and(
          eq(experienceSourceMappings.provider, WHEREWOLF_PROVIDER),
          eq(
            experienceSourceMappings.providerObjectType,
            WHEREWOLF_ACTIVITY_OBJECT_TYPE,
          ),
          eq(experienceSourceMappings.externalId, activityId),
        ),
      )
      .limit(1);

    return rows[0];
  }

  private async upsertMapping(
    tx: Pick<DatabaseService["db"], "insert" | "update">,
    input: {
      activityId: string;
      experienceId: string;
      existingMapping?: {
        id: string;
        experienceId: string;
      };
      createdExperience: boolean;
    },
  ): Promise<WherewolfExperienceMapResult> {
    if (input.existingMapping) {
      if (input.existingMapping.experienceId !== input.experienceId) {
        return {
          outcome: "conflict",
          activityId: input.activityId,
          mappedExperienceId: input.existingMapping.experienceId,
        };
      }

      return {
        outcome: "unchanged",
        activityId: input.activityId,
        experienceId: input.experienceId,
      };
    }

    await tx.insert(experienceSourceMappings).values({
      experienceId: input.experienceId,
      provider: WHEREWOLF_PROVIDER,
      providerObjectType: WHEREWOLF_ACTIVITY_OBJECT_TYPE,
      externalId: input.activityId,
    });

    return {
      outcome: "created",
      activityId: input.activityId,
      experienceId: input.experienceId,
      createdExperience: input.createdExperience,
    };
  }
}
