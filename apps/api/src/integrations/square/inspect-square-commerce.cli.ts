import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { SquareCommerceInspectService } from "./square-commerce-inspect.service";
import { parseFarmWindow } from "./square.range";

async function main(): Promise<void> {
  loadEnvFiles();
  const window = parseFarmWindow(process.argv.slice(2));
  if (!window) {
    console.error(
      "Usage: npm run inspect:square-commerce -- --date YYYY-MM-DD",
    );
    console.error(
      "   or: npm run inspect:square-commerce -- --from YYYY-MM-DD --to YYYY-MM-DD",
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const inspector = app.get(SquareCommerceInspectService);
    const summary = await inspector.inspectWindow(window);
    console.log(inspector.format(summary));
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "inspect failed";
  console.error(message);
  process.exitCode = 1;
});
