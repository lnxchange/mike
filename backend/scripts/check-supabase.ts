/**
 * Supabase connectivity + schema health check.
 *
 * Run with: npm run check:supabase --prefix backend
 * (reads backend/.env, so run it from the repo root or backend/ either way)
 *
 * This does NOT modify any data. It only reads. Safe to run against a fresh
 * or existing Supabase project.
 *
 * Exit code 0 = all required checks passed. Exit code 1 = something is
 * missing or misconfigured; read the printed report for what to fix.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const REQUIRED_TABLES = [
  "user_profiles",
  "projects",
  "project_subfolders",
  "documents",
  "document_versions",
  "document_edits",
  "workflows",
  "hidden_workflows",
  "workflow_shares",
  "chats",
  "chat_messages",
  "tabular_reviews",
  "tabular_cells",
  "tabular_review_chats",
  "tabular_review_chat_messages",
];

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
  required: boolean;
};

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail: string, required = true) {
  results.push({ name, ok, detail, required });
}

async function main() {
  console.log("Mike / Supabase health check\n");

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !serviceKey) {
    record(
      "Environment variables",
      false,
      "SUPABASE_URL and/or SUPABASE_SECRET_KEY are not set. Copy backend/.env.example to backend/.env and fill them in.",
    );
    printReport();
    process.exit(1);
  }
  record("Environment variables", true, `SUPABASE_URL=${supabaseUrl}`);

  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { persistSession: false },
  });

  // 1. Basic connectivity + does the schema exist at all?
  try {
    const { error } = await supabase
      .from("user_profiles")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    record(
      "Connectivity",
      true,
      "Connected to Supabase and queried public.user_profiles successfully.",
    );
  } catch (err) {
    record(
      "Connectivity",
      false,
      `Could not query public.user_profiles: ${errMessage(err)}. ` +
        "Either the schema has not been applied yet (see SUPABASE_SETUP.md) " +
        "or SUPABASE_URL/SUPABASE_SECRET_KEY are wrong.",
    );
    printReport();
    process.exit(1);
  }

  // 2. Every table from schema.sql exists and is reachable with the service role.
  for (const table of REQUIRED_TABLES) {
    try {
      const { error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      record(`Table: ${table}`, true, "reachable");
    } catch (err) {
      record(
        `Table: ${table}`,
        false,
        `Not reachable: ${errMessage(err)}. Re-run backend/schema.sql in the Supabase SQL editor.`,
      );
    }
  }

  // 3. Auth admin API works (confirms the service role key is valid, not just
  //    a well-formed string, and that Auth is reachable).
  try {
    const { error } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });
    if (error) throw error;
    record("Auth admin API", true, "Service role key can call the Auth admin API.");
  } catch (err) {
    record(
      "Auth admin API",
      false,
      `Auth admin call failed: ${errMessage(err)}. Double-check SUPABASE_SECRET_KEY is the service role key, not the anon key.`,
    );
  }

  // 4. Storage (S3-compatible) — optional, warn only.
  const storageConfigured = Boolean(
    process.env.R2_ENDPOINT_URL &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
  record(
    "Object storage config",
    storageConfigured,
    storageConfigured
      ? `R2_BUCKET_NAME=${process.env.R2_BUCKET_NAME ?? "mike"}`
      : "R2_ENDPOINT_URL / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY not set — uploads and downloads will be disabled until configured.",
    false,
  );

  printReport();
  const requiredFailures = results.filter((r) => r.required && !r.ok);
  process.exit(requiredFailures.length > 0 ? 1 : 0);
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function printReport() {
  console.log("");
  for (const r of results) {
    const icon = r.ok ? "PASS" : r.required ? "FAIL" : "WARN";
    console.log(`[${icon}] ${r.name} — ${r.detail}`);
  }
  const requiredFailures = results.filter((r) => r.required && !r.ok);
  console.log("");
  if (requiredFailures.length === 0) {
    console.log("All required checks passed.");
  } else {
    console.log(
      `${requiredFailures.length} required check(s) failed. See SUPABASE_SETUP.md for setup steps.`,
    );
  }
}

main().catch((err) => {
  console.error("Health check crashed unexpectedly:", err);
  process.exit(1);
});
