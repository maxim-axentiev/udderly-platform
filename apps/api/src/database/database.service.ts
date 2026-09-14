import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import * as schema from "./schema";

export type AppDatabase = PostgresJsDatabase<typeof schema>;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    readonly db: AppDatabase,
    private readonly client: postgres.Sql,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ping();
      this.logger.log("Connected to PostgreSQL");
    } catch (error) {
      this.logger.error(
        "PostgreSQL is not reachable. Start Docker services and retry.",
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }
}
