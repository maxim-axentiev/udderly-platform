import { Module } from "@nestjs/common";
import { EnvModule } from "../../config/env.module";
import { DatabaseModule } from "../../database/database.module";
import { MetaAdsImportService } from "./meta-ads-import.service";

@Module({
  imports: [EnvModule, DatabaseModule],
  providers: [MetaAdsImportService],
  exports: [MetaAdsImportService],
})
export class MetaAdsModule {}
