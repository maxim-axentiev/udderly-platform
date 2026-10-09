import { Module } from "@nestjs/common";
import { EnvModule } from "../../config/env.module";
import { DatabaseModule } from "../../database/database.module";
import { MailchimpImportService } from "./mailchimp-import.service";

@Module({
  imports: [EnvModule, DatabaseModule],
  providers: [MailchimpImportService],
  exports: [MailchimpImportService],
})
export class MailchimpModule {}
