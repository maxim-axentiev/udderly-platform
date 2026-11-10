import { resolve } from "node:path";
import { loadEnvFiles } from "../config/load-env";
import { connectStaffInventory } from "./naming-inventory-import.client";
import {
  IMPORT_CONFIRMATION,
  PRODUCTION_IMPORT_CONFIRMATION,
  assertImportHost,
  preflightManifest,
  readStaffPassword,
  runInventoryImport,
  type ImportReport,
} from "./naming-inventory-import";

type CliOptions = {
  manifestPath: string;
  baseUrl: string;
  root: string;
  progressPath: string;
  mode: "dry-run" | "execute";
  target: "local" | "production";
  limit?: number;
};

export function importUsage(): string {
  return [
    "Usage: npm run naming:import-inventory:dev -- [options]",
    "Dry-run is the default. A live import creates unpublished objects only.",
    "",
    "Options:",
    "  --manifest <file>",
    "  --base-url <http://127.0.0.1:port>",
    "  --root <directory>",
    "  --progress <file>",
    "  --limit <count>",
    "  --execute --confirm IMPORT-UNPUBLISHED",
    "  --target production --execute --confirm IMPORT-UNPUBLISHED --confirm-production IMPORT-PRODUCTION-UNPUBLISHED",
    "",
    "The staff password is read from NAMING_ADMIN_PASSWORD or NAMING_ADMIN_PASSWORD_FILE.",
    "Every target must be a loopback API. A production dry-run is read-only.",
    "Production writes also require --confirm-production IMPORT-PRODUCTION-UNPUBLISHED.",
  ].join("\n");
}

export function parseImportArgs(
  argv: string[],
  defaults: { manifestPath: string; root: string; progressPath: string },
): { ok: true; options: CliOptions } | { ok: false; message: string } {
  let manifestPath = defaults.manifestPath;
  let baseUrl = "http://127.0.0.1:3001";
  let root = defaults.root;
  let progressPath = defaults.progressPath;
  let execute = false;
  let confirm = "";
  let productionConfirm = "";
  let target: "local" | "production" = "local";
  let limit: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--help") {
      return { ok: false, message: importUsage() };
    }
    if (token === "--execute") {
      execute = true;
      continue;
    }
    const value = readOption(argv, index, token);
    if (value.consumed) {
      index += value.extra;
    }
    if (token === "--confirm" || token.startsWith("--confirm=")) {
      confirm = value.text ?? "";
      continue;
    }
    if (token === "--confirm-production" || token.startsWith("--confirm-production=")) {
      productionConfirm = value.text ?? "";
      continue;
    }
    if (token === "--target" || token.startsWith("--target=")) {
      if (value.text !== "local" && value.text !== "production") {
        return { ok: false, message: "Import target must be local or production." };
      }
      target = value.text;
      continue;
    }
    if (token === "--manifest" || token.startsWith("--manifest=")) {
      manifestPath = value.text ?? "";
      continue;
    }
    if (token === "--base-url" || token.startsWith("--base-url=")) {
      baseUrl = value.text ?? "";
      continue;
    }
    if (token === "--root" || token.startsWith("--root=")) {
      root = value.text ?? "";
      continue;
    }
    if (token === "--progress" || token.startsWith("--progress=")) {
      progressPath = value.text ?? "";
      continue;
    }
    if (token === "--limit" || token.startsWith("--limit=")) {
      if (!value.text || !/^[1-9]\d*$/.test(value.text)) {
        return { ok: false, message: "Import limit must be a positive integer." };
      }
      limit = Number(value.text);
      continue;
    }
    return { ok: false, message: `Unknown option ${token}.\n${importUsage()}` };
  }
  if (confirm && !execute) {
    return { ok: false, message: "--confirm is only valid with --execute." };
  }
  if (productionConfirm && target !== "production") {
    return { ok: false, message: "--confirm-production is only valid with --target production." };
  }
  if (execute && confirm !== IMPORT_CONFIRMATION) {
    return {
      ok: false,
      message: "Live import requires --execute --confirm IMPORT-UNPUBLISHED.",
    };
  }
  if (
    target === "production" &&
    execute &&
    productionConfirm !== PRODUCTION_IMPORT_CONFIRMATION
  ) {
    return {
      ok: false,
      message:
        "Production writes require --target production --execute --confirm IMPORT-UNPUBLISHED --confirm-production IMPORT-PRODUCTION-UNPUBLISHED.",
    };
  }
  if (!manifestPath || !baseUrl || !root || !progressPath) {
    return { ok: false, message: importUsage() };
  }
  return {
    ok: true,
    options: {
      manifestPath,
      baseUrl,
      root,
      progressPath,
      mode: execute ? "execute" : "dry-run",
      target,
      ...(limit !== undefined ? { limit } : {}),
    },
  };
}

export async function runImportCli(
  argv: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; report: ImportReport | null; stderr: string }> {
  const parsed = parseImportArgs(argv, defaultPaths());
  if (!parsed.ok) {
    return { code: argv.includes("--help") ? 0 : 2, report: null, stderr: parsed.message };
  }
  try {
    assertImportHost(parsed.options.baseUrl);
  } catch (error) {
    return { code: 2, report: null, stderr: error instanceof Error ? error.message : "Refusing the API host." };
  }
  const blocked = preflightManifest(
    parsed.options.manifestPath,
    parsed.options.root,
    parsed.options.progressPath,
    parsed.options.mode,
  );
  if (blocked) {
    return { code: 1, report: blocked, stderr: "" };
  }
  let password = "";
  try {
    password = readStaffPassword(env);
    const api = await connectStaffInventory(parsed.options.baseUrl, password);
    const report = await runInventoryImport({
      manifestPath: parsed.options.manifestPath,
      root: parsed.options.root,
    mode: parsed.options.mode,
    target: parsed.options.target,
    ...(parsed.options.limit !== undefined ? { limit: parsed.options.limit } : {}),
      api,
      progressPath: parsed.options.progressPath,
    });
    return { code: report.failures.length > 0 ? 1 : 0, report, stderr: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inventory import failed.";
    const redacted = password.length > 0 ? message.split(password).join("[redacted]") : message;
    return { code: 1, report: null, stderr: redacted };
  }
}

function defaultPaths(): { manifestPath: string; root: string; progressPath: string } {
  const root = resolve(__dirname, "../../../..");
  return {
    root,
    manifestPath: resolve(root, "assets/gift-card-campaign/inventory-manifest.csv"),
    progressPath: resolve(root, ".local/naming-inventory-import-progress.json"),
  };
}

function readOption(
  argv: string[],
  index: number,
  token: string,
): { text?: string; extra: number; consumed: boolean } {
  const equals = token.indexOf("=");
  if (equals >= 0) {
    return { text: token.slice(equals + 1), extra: 0, consumed: false };
  }
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) {
    return { extra: 0, consumed: false };
  }
  return { text: next, extra: 1, consumed: true };
}

async function main(): Promise<void> {
  loadEnvFiles();
  const result = await runImportCli(process.argv.slice(2), process.env);
  if (result.stderr) {
    console.error(result.stderr);
  }
  if (result.report) {
    console.log(JSON.stringify(result.report, null, 2));
  }
  process.exitCode = result.code;
}

if (require.main === module) {
  void main();
}
