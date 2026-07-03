import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.string().default("info"),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  SUPABASE_JWT_SECRET: z.string(),

  REDIS_URL: z.string(),

  AI_GATEWAY_URL: z.string().url(),
  AI_GATEWAY_API_KEY: z.string().optional().default(""),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  AI_MODEL_DEFAULT: z.string().default("openai/gpt-4.1-mini"),
  AI_MODEL_REVIEW: z.string().default("openai/gpt-4.1-mini"),

  GITHUB_TOKEN: z.string().optional().default(""),
  GITHUB_APP_ID: z.string().optional().default(""),
  GITHUB_APP_CLIENT_ID: z.string().optional().default(""),
  GITHUB_APP_CLIENT_SECRET: z.string().optional().default(""),
  GITHUB_APP_PRIVATE_KEY: z.string().optional().default(""),
  GITHUB_WEBHOOK_SECRET: z.string().optional().default(""),

  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().default(""),

  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),

  ENCRYPTION_KEY: z.string().min(64, "ENCRYPTION_KEY must be 32-byte hex (64 chars)"),

  SANDBOX_PROVIDER: z.enum(["local", "docker", "fly", "e2b"]).default("local"),
  SANDBOX_IMAGE: z.string().default("node:20-bookworm"),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
