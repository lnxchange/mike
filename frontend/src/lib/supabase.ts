import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";

/**
 * True when both Supabase env vars are present. Pages/components can use
 * this to show a helpful setup message instead of letting auth calls fail
 * with an opaque error.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured && typeof window === "undefined") {
    // Runs during `next build` / SSR. Without this guard, the missing env
    // vars would throw inside `createClient` and crash the entire build
    // (including pages that only need this module for a client-side auth
    // check). Log once so the failure mode is obvious in build output.
    console.warn(
        "[mike] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY " +
            "are not set. Supabase auth will not work until they are configured " +
            "(see .env.example / README).",
    );
}

// Fall back to a syntactically valid placeholder so `createClient` never
// throws at import time. Real requests will fail with a clear Supabase
// error (e.g. "Invalid API key") instead of a crash, and `next build` can
// still prerender pages that merely import this module.
export const supabase = createClient(
    supabaseUrl || "https://placeholder.supabase.co",
    supabaseAnonKey || "placeholder-anon-key",
);
