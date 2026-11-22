import "server-only";
import { z } from "zod";

/**
 * Server-side configuration, validated once. Secrets never leave the server:
 * only NEXT_PUBLIC_* values are exposed to the browser bundle.
 */
const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
  MOCK_PROVIDERS: z.string().default("auto"),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL_RESEARCH: z.string().default("gpt-5.4-mini"),
  OPENAI_MODEL_SCORING: z.string().default("gpt-5.4-mini"),
  OPENAI_MODEL_EMAIL: z.string().default("gpt-5.5"),
  OPENAI_MODEL_REPLIES: z.string().default("gpt-5.4-mini"),

  GOOGLE_MAPS_API_KEY: z.string().optional(),
  GOOGLE_PAGESPEED_API_KEY: z.string().optional(),

  KVK_API_KEY: z.string().optional(),
  KVK_BASE: z.string().url().default("https://api.kvk.nl/test/api"),

  HUNTER_API_KEY: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  EMAIL_PROVIDER_API_KEY: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_OAUTH_CLIENT_ID: z.string().optional(),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().optional(),

  ENCRYPTION_KEY: z.string().optional(),
  UNSUBSCRIBE_SECRET: z.string().optional(),

  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function blankToUndefined(source: NodeJS.ProcessEnv) {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(source)) out[k] = v === "" ? undefined : v;
  return out;
}

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(blankToUndefined(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests only. */
export function resetEnvCache() {
  cached = null;
}

export const isProduction = () => env().APP_ENV === "production";
