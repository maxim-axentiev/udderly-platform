import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { loadEnvFiles } from "../config/load-env";
import {
  deliverResultText,
  deliverUsageText,
  parseNamingDeliverCommand,
} from "./naming-link-delivery.command";
import { NamingLinkDeliveryService } from "./naming-link-delivery.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const command = parseNamingDeliverCommand(process.argv.slice(2));
  if (!command) {
    console.error(deliverUsageText());
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  try {
    const delivery = app.get(NamingLinkDeliveryService);
    const result = await delivery.deliver(command.reservationId, {
      reissue: command.reissue,
    });
    const text = deliverResultText(result.outcome);
    if (result.outcome === "sent") {
      console.log(text);
      return;
    }
    console.error(text);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "naming delivery failed";
  console.error(message);
  process.exitCode = 1;
});
