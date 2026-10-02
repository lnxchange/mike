/**
 * Seed the background energy / Vic legislation shelf.
 *
 * Run with: npm run seed:energy-shelf --prefix backend
 * Reads backend/.env (or the current working directory .env).
 *
 * Applies nothing to remote/production databases. Point SUPABASE_URL at
 * local Compose unless you have been asked to seed another confirmed target.
 *
 * Existing deployments need
 * backend/migrations/20260921_07_legal_source_documents.sql (or a fresh
 * schema.sql) before this can write. South Australian host Acts often 403;
 * set EXA_API_KEY to retrieve those through Exa Contents.
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    formatShelfSeedSummary,
    resolveShelfScope,
    seedEnergyShelf,
    storeForShelfScope,
} from "../src/lib/legalSourceShelf";
import { createServerSupabase } from "../src/lib/supabase";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../.env") });
config();

async function main() {
    console.log("Energy shelf seed\n");
    let db;
    try {
        db = createServerSupabase();
    } catch (err) {
        console.error(
            err instanceof Error ? err.message : "Supabase is not configured.",
        );
        console.error(
            "Set SUPABASE_URL and SUPABASE_SECRET_KEY in backend/.env, then retry.",
        );
        process.exit(1);
    }

    const { error: tableError } = await db
        .from("legal_source_documents")
        .select("id", { count: "exact", head: true });
    if (tableError) {
        console.error(
            `legal_source_documents is not reachable: ${tableError.message}`,
        );
        console.error(
            "Apply backend/migrations/20260921_07_legal_source_documents.sql to this local database, or recreate from backend/schema.sql. Do not apply that migration to production unless it has been confirmed.",
        );
        process.exit(1);
    }

    const scope = await resolveShelfScope(db);
    console.log(`Scope: ${scope.label}\n`);
    const store = storeForShelfScope(db, scope);
    const rows = await seedEnergyShelf({ store });
    console.log(formatShelfSeedSummary(rows));
    const stored = rows.filter((row) => !row.error);
    const failed = rows.filter((row) => row.error);
    console.log(
        `\nStored ${stored.length}. Failed ${failed.length}. See docs/au-energy.md.`,
    );
    process.exit(failed.length === rows.length ? 1 : 0);
}

main().catch((err) => {
    console.error("Energy shelf seed crashed:", err);
    process.exit(1);
});
