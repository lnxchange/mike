/**
 * Startup environment validation.
 *
 * Fails fast with a clear, actionable message when required configuration
 * is missing, instead of letting the server boot into a broken state where
 * every request fails with an opaque 500. Optional-but-recommended
 * variables are logged as warnings so the instance still starts (useful for
 * first-time setup where you want to see the app render before wiring up
 * every provider).
 *
 * See backend/.env.example for the full list of variables and where each
 * one comes from.
 */

interface EnvCheck {
  name: string;
  hint: string;
}

const REQUIRED: EnvCheck[] = [
  {
    name: "SUPABASE_URL",
    hint: "Supabase project URL, e.g. https://your-project.supabase.co (Project Settings > API).",
  },
  {
    name: "SUPABASE_SECRET_KEY",
    hint: "Supabase service role key (Project Settings > API). Never expose this to the browser.",
  },
];

const RECOMMENDED: EnvCheck[] = [
  {
    name: "DOWNLOAD_SIGNING_SECRET",
    hint: "Generate with `openssl rand -hex 32`. Without it, generated-document downloads fail at request time.",
  },
  {
    name: "R2_ENDPOINT_URL",
    hint: "S3-compatible storage endpoint (Cloudflare R2, MinIO, etc). Without storage configured, uploads/downloads are disabled.",
  },
  {
    name: "R2_ACCESS_KEY_ID",
    hint: "Access key for the storage bucket above.",
  },
  {
    name: "R2_SECRET_ACCESS_KEY",
    hint: "Secret key for the storage bucket above.",
  },
];

const AT_LEAST_ONE_OF = [
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
];

export function validateEnv(): void {
  const missingRequired = REQUIRED.filter((v) => !process.env[v.name]);
  const missingRecommended = RECOMMENDED.filter((v) => !process.env[v.name]);
  const hasModelProvider = AT_LEAST_ONE_OF.some((name) => process.env[name]);

  if (missingRequired.length > 0) {
    console.error(
      "\nMike backend cannot start: missing required environment variables.\n",
    );
    for (const v of missingRequired) {
      console.error(`  - ${v.name}: ${v.hint}`);
    }
    console.error(
      "\nCopy backend/.env.example to backend/.env, fill in the values, and restart.\n",
    );
    process.exit(1);
  }

  if (missingRecommended.length > 0) {
    console.warn(
      "\n[mike] Some recommended environment variables are not set. The server will start, but related features will not work until they are configured:\n",
    );
    for (const v of missingRecommended) {
      console.warn(`  - ${v.name}: ${v.hint}`);
    }
    console.warn("");
  }

  if (!hasModelProvider) {
    console.warn(
      "[mike] No model provider key set (ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY). " +
        "Users can still add personal keys in Account > Models & API Keys, but no provider is available instance-wide.\n",
    );
  }
}
