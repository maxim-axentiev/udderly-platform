import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { DatabaseService } from "../../database/database.service";
import { MailchimpImportService } from "./mailchimp-import.service";
import { MAILCHIMP_INCREMENTAL_LOCK_NAME } from "./mailchimp.constants";
import { formatMailchimpLockError } from "./mailchimp.errors";
import {
  parseMailchimpIncrementalArgs,
  runMailchimpIncremental,
} from "./mailchimp.incremental";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  try {
    if (args.includes("--from") || args.includes("--to")) {
      console.error(
        "Incremental sync does not accept --from/--to. Use import:mailchimp for an explicit historical range.",
      );
      process.exitCode = 1;
      return;
    }

    const plan = parseMailchimpIncrementalArgs(args);
    if (plan.dryRun) {
      const result = await runMailchimpIncremental(
        {
          importAccount: async () => {
            throw new Error("dry_run");
          },
          importWindow: async () => {
            throw new Error("dry_run");
          },
          reconcileWindow: () => {
            throw new Error("dry_run");
          },
        },
        plan,
        console.log,
      );
      if (!result.ok) {
        process.exitCode = 1;
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
      await database.withAdvisoryLock(MAILCHIMP_INCREMENTAL_LOCK_NAME, async () => {
        const result = await runMailchimpIncremental(
          {
            importAccount: () => importer.importAccount(),
            importWindow: (window) =>
              importer.importWindow({
                startDate: window.from,
                endDate: window.to,
                importActivity: window.importActivity,
                importCampaigns: window.importCampaigns,
              }),
            reconcileWindow: (imported) =>
              importer.reconcileImportedWindow(imported),
          },
          plan,
          console.log,
        );
        if (!result.ok) {
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
