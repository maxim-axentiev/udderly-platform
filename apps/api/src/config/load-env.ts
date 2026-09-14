import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

export function loadEnvFiles(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];

  for (const file of candidates) {
    if (existsSync(file)) {
      loadDotenv({ path: file, override: false, quiet: true });
    }
  }
}
