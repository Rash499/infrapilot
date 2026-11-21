import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Optional during the staged migration; required once all PostgreSQL service modules are removed.
  MONGODB_URI: z.string().optional(),
  MONGODB_DB: z.string().min(1).default("infrapilot"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(14),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(180).default(30),
  EXPOSE_RESET_TOKEN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  TRUST_PROXY_HEADERS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  INFRAPILOT_EMBEDDED_WORKER: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  MONITOR_TICK_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  MONITOR_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  MONITOR_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(25),
  MONITOR_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(3),
  MONITOR_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  REQUIRED_CHANGE_APPROVALS: z.coerce.number().int().min(1).max(5).default(1),
  APP_ORIGIN: z.string().url().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

/** Lazily validates environment variables so that the build does not require runtime secrets. */
export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
