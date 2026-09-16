import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { hashCanonicalJson } from "./wherewolf.hash";
import { WHEREWOLF_PROVIDER } from "./wherewolf.constants";
import { sanitizeWherewolfSnapshotPayload } from "./wherewolf.sanitize";

export type WherewolfResanitizeSummary = {
  scanned: number;
  updated: number;
  deduplicated: number;
  unchanged: number;
  skipped: number;
};

@Injectable()
export class WherewolfResanitizeService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async resanitize(): Promise<WherewolfResanitizeSummary> {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('ww-resanitize-snapshots', 0))`,
      );

      const rows = await tx
        .select()
        .from(sourceSnapshots)
        .where(eq(sourceSnapshots.provider, WHEREWOLF_PROVIDER))
        .orderBy(asc(sourceSnapshots.observedAt), asc(sourceSnapshots.id));

      const summary: WherewolfResanitizeSummary = {
        scanned: rows.length,
        updated: 0,
        deduplicated: 0,
        unchanged: 0,
        skipped: 0,
      };
      const deleted = new Set<string>();

      for (const row of rows) {
        if (deleted.has(row.id)) {
          continue;
        }

        const sanitized = sanitizeWherewolfSnapshotPayload(
          row.entityType,
          row.payload,
        );
        if (!sanitized) {
          summary.skipped += 1;
          continue;
        }

        const newHash = hashCanonicalJson(sanitized);
        const alreadyClean =
          newHash === row.payloadHash &&
          newHash === hashCanonicalJson(row.payload);
        if (alreadyClean) {
          summary.unchanged += 1;
          continue;
        }

        const collision = rows.find(
          (other) =>
            other.id !== row.id &&
            !deleted.has(other.id) &&
            other.entityType === row.entityType &&
            other.externalId === row.externalId &&
            sanitizedHash(other) === newHash,
        );

        if (collision) {
          const keepCurrent =
            row.observedAt.getTime() < collision.observedAt.getTime() ||
            (row.observedAt.getTime() === collision.observedAt.getTime() &&
              row.id < collision.id);
          if (keepCurrent) {
            await tx
              .delete(sourceSnapshots)
              .where(eq(sourceSnapshots.id, collision.id));
            deleted.add(collision.id);
            await tx
              .update(sourceSnapshots)
              .set({ payload: sanitized, payloadHash: newHash })
              .where(eq(sourceSnapshots.id, row.id));
            row.payload = sanitized;
            row.payloadHash = newHash;
            summary.updated += 1;
            summary.deduplicated += 1;
          } else {
            await tx
              .delete(sourceSnapshots)
              .where(eq(sourceSnapshots.id, row.id));
            deleted.add(row.id);
            summary.deduplicated += 1;
          }
          continue;
        }

        await tx
          .update(sourceSnapshots)
          .set({ payload: sanitized, payloadHash: newHash })
          .where(
            and(
              eq(sourceSnapshots.id, row.id),
              eq(sourceSnapshots.provider, WHEREWOLF_PROVIDER),
            ),
          );
        row.payload = sanitized;
        row.payloadHash = newHash;
        summary.updated += 1;
      }

      return summary;
    });
  }
}

function sanitizedHash(row: {
  entityType: string;
  payload: Record<string, unknown>;
  payloadHash: string;
}): string {
  const sanitized = sanitizeWherewolfSnapshotPayload(
    row.entityType,
    row.payload,
  );
  return sanitized ? hashCanonicalJson(sanitized) : row.payloadHash;
}
