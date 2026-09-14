import { Module } from "@nestjs/common";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { EnvService } from "../config/env.service";
import { DRIZZLE, POSTGRES_CLIENT } from "./database.constants";
import { DatabaseService } from "./database.service";
import * as schema from "./schema";

@Module({
  providers: [
    {
      provide: POSTGRES_CLIENT,
      inject: [EnvService],
      useFactory: (env: EnvService) =>
        postgres(env.databaseUrl, {
          max: 10,
          onnotice: () => undefined,
        }),
    },
    {
      provide: DRIZZLE,
      inject: [POSTGRES_CLIENT],
      useFactory: (client: postgres.Sql) => drizzle(client, { schema }),
    },
    {
      provide: DatabaseService,
      inject: [DRIZZLE, POSTGRES_CLIENT],
      useFactory: (db: DatabaseService["db"], client: postgres.Sql) =>
        new DatabaseService(db, client),
    },
  ],
  exports: [DatabaseService, DRIZZLE],
})
export class DatabaseModule {}
