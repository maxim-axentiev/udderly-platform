import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { sourceObjectClassifications } from "../../database/schema/source-object-classification";
import { FAREHARBOR_PROVIDER } from "./fareharbor.crypto";
import {
  FAREHARBOR_NON_EXPERIENCE_CLASSIFICATION,
  FAREHARBOR_REPORT_ITEM_OBJECT_TYPE,
} from "./fareharbor.constants";

export type FareharborReportItemClassifyResult =
  | { outcome: "created"; itemLabel: string; classification: string }
  | { outcome: "unchanged"; itemLabel: string; classification: string }
  | {
      outcome: "conflict";
      itemLabel: string;
      existingClassification: string;
    }
  | { outcome: "invalid"; reason: "item_label" | "classification" };

@Injectable()
export class FareharborReportItemClassifyService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async classifyNonExperience(
    itemLabel: string,
  ): Promise<FareharborReportItemClassifyResult> {
    const label = itemLabel.trim();
    if (!label) {
      return { outcome: "invalid", reason: "item_label" };
    }

    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`fh-report-item-class-${label}`}, 0))`,
      );

      const existing = await tx
        .select({
          id: sourceObjectClassifications.id,
          classification: sourceObjectClassifications.classification,
        })
        .from(sourceObjectClassifications)
        .where(
          and(
            eq(sourceObjectClassifications.provider, FAREHARBOR_PROVIDER),
            eq(
              sourceObjectClassifications.providerObjectType,
              FAREHARBOR_REPORT_ITEM_OBJECT_TYPE,
            ),
            eq(sourceObjectClassifications.externalId, label),
          ),
        )
        .limit(1);

      if (existing[0]) {
        if (
          existing[0].classification !==
          FAREHARBOR_NON_EXPERIENCE_CLASSIFICATION
        ) {
          return {
            outcome: "conflict" as const,
            itemLabel: label,
            existingClassification: existing[0].classification,
          };
        }
        return {
          outcome: "unchanged" as const,
          itemLabel: label,
          classification: FAREHARBOR_NON_EXPERIENCE_CLASSIFICATION,
        };
      }

      await tx.insert(sourceObjectClassifications).values({
        provider: FAREHARBOR_PROVIDER,
        providerObjectType: FAREHARBOR_REPORT_ITEM_OBJECT_TYPE,
        externalId: label,
        classification: FAREHARBOR_NON_EXPERIENCE_CLASSIFICATION,
      });

      return {
        outcome: "created" as const,
        itemLabel: label,
        classification: FAREHARBOR_NON_EXPERIENCE_CLASSIFICATION,
      };
    });
  }
}
