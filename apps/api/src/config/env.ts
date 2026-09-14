import { z } from "zod";
import { loadEnvFiles } from "./load-env";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .min(1, "DATABASE_URL is required"),
  REDIS_URL: z
    .string({ required_error: "REDIS_URL is required" })
    .min(1, "REDIS_URL is required"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
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
