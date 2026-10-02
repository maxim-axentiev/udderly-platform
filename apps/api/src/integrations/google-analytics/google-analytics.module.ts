import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { GoogleAnalyticsImportService } from "./google-analytics-import.service";

@Module({
  imports: [DatabaseModule],
  providers: [GoogleAnalyticsImportService],
  exports: [GoogleAnalyticsImportService],
})
export class GoogleAnalyticsModule {}
