import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { DatabaseService } from "../../database/database.service";
import { MailchimpImportService } from "./mailchimp-import.service";
import { MAILCHIMP_IMPORT_LOCK_NAME } from "./mailchimp.constants";
import {
  formatMailchimpImportPlan,
  parseMailchimpImportArgs,
} from "./mailchimp.import-plan";
import { formatMailchimpLockError } from "./mailchimp.errors";
import { assertHistoricalMailchimpRange } from "./mailchimp.range";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  try {
    const plan = parseMailchimpImportArgs(args);
    if (plan.dryRun) {
      for (const line of formatMailchimpImportPlan(plan)) {
        console.log(line);
      }
      return;
    }

    loadEnvFiles();
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ["error", "warn"],
    });

    try {
      const importer = app.get(MailchimpImportService);
      const database = app.get(DatabaseService);
      await database.withAdvisoryLock(MAILCHIMP_IMPORT_LOCK_NAME, async () => {
        const account = await importer.importAccount();
        console.log(
          `account ${account.accountId} name=${account.name ?? "(unknown)"}`,
        );
        if (plan.accountOnly) {
          return;
        }
        if (!plan.from || !plan.to) {
          process.exitCode = 1;
          return;
        }
        assertHistoricalMailchimpRange(plan.from, plan.to);
        const imported = await importer.importWindow({
          startDate: plan.from,
          endDate: plan.to,
        });
        const verdict = importer.reconcileImportedWindow(imported);
        console.log(
          `import ${plan.from}..${plan.to} ${verdict.passed ? "PASS" : "FAIL"} audiences=${imported.audienceCount} campaigns=${imported.campaignCount} reports=${imported.reportCount} published=${imported.publishedDates.length} unpublished=${imported.possiblyUnpublishedDates.length}`,
        );
        for (const line of verdict.diagnostics) {
          console.log(line);
        }
        if (!verdict.passed) {
          console.error(verdict.differences.join("\n"));
          process.exitCode = 1;
        }
      });
    } finally {
      await app.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(formatMailchimpLockError(message));
    process.exitCode = 1;
  }
}

void main();
