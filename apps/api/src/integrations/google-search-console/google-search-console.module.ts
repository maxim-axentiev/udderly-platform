import { Module } from "@nestjs/common";
import { EnvModule } from "../../config/env.module";
import { DatabaseModule } from "../../database/database.module";
import { GoogleSearchConsoleImportService } from "./google-search-console-import.service";

@Module({
  imports: [EnvModule, DatabaseModule],
  providers: [GoogleSearchConsoleImportService],
  exports: [GoogleSearchConsoleImportService],
})
export class GoogleSearchConsoleModule {}
