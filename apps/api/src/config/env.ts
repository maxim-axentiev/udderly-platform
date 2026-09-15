import { z } from "zod";
import { loadEnvFiles } from "./load-env";

const optionalTrimmedSecret = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_LISTEN_HOST: z.string().min(1).default("127.0.0.1"),
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .min(1, "DATABASE_URL is required"),
  REDIS_URL: z
    .string({ required_error: "REDIS_URL is required" })
    .min(1, "REDIS_URL is required"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  WHEREWOLF_API_KEY: optionalTrimmedSecret,
  WHEREWOLF_APP_ID: optionalTrimmedSecret,
  FAREHARBOR_WEBHOOK_SECRET: optionalTrimmedSecret,
  SQUARE_ACCESS_TOKEN: optionalTrimmedSecret,
  SQUARE_APPLICATION_ID: optionalTrimmedSecret,
  SQUARE_LOCATION_ID: optionalTrimmedSecret,
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  loadEnvFiles();

  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid environment variables. Copy \`.env.example\` to \`.env\` in the repository root.\n${details}`,
    );
  }

  return parsed.data;
}
