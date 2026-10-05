import { looksLikeBotChallenge } from "./officialSourceAccess";
import { exaConfiguration } from "./runtimeConfig";

const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
const MIN_USEFUL_CHARS = 400;
/** Always live-crawl: we only call Exa after the official host blocked us. */
const CONTENTS_MAX_AGE_HOURS = 0;
const CONTENTS_LIVECRAWL_TIMEOUT_MS = 30_000;

export type ExaContentsResult = {
    text: string;
    url: string;
    title: string | null;
};

export type ExaContentsFetch = (
    url: string,
) => Promise<ExaContentsResult | null>;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function usefulText(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const text = value.replace(/\u0000/g, "").trim();
    if (text.length < MIN_USEFUL_CHARS) return null;
    if (looksLikeBotChallenge(Buffer.from(text.slice(0, 1200)))) return null;
    return text;
}

function contentsUrlFailed(payload: unknown, href: string): boolean {
    const statuses = Array.isArray(asRecord(payload)?.statuses)
        ? (asRecord(payload)!.statuses as unknown[])
        : [];
    return statuses.some((row) => {
        const record = asRecord(row);
        if (!record) return false;
        const status =
            typeof record.status === "string" ? record.status.toLowerCase() : "";
        if (status !== "error") return false;
        const id = typeof record.id === "string" ? record.id : "";
        return !id || id === href;
    });
}

/**
 * Pull the readable text of an official page or PDF through Exa Contents.
 * Used when the official host blocks Mike's own download. The citation URL
 * stays the official one the caller asked for.
 */
export async function fetchExaContents(
    url: string,
    env: NodeJS.ProcessEnv = process.env,
    fetchImpl: typeof fetch = fetch,
): Promise<ExaContentsResult | null> {
    const href = url.trim();
    if (!href) return null;
    const { configured, apiKey } = exaConfiguration(env);
    if (!configured) return null;

    let response: Response;
    try {
        response = await fetchImpl(EXA_CONTENTS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
            },
            body: JSON.stringify({
                urls: [href],
                text: true,
                maxAgeHours: CONTENTS_MAX_AGE_HOURS,
                livecrawlTimeout: CONTENTS_LIVECRAWL_TIMEOUT_MS,
            }),
        });
    } catch {
        return null;
    }
    if (!response.ok) return null;

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        return null;
    }
    if (contentsUrlFailed(payload, href)) return null;
    const rows = Array.isArray(asRecord(payload)?.results)
        ? (asRecord(payload)!.results as unknown[])
        : [];
    for (const row of rows) {
        const record = asRecord(row);
        if (!record) continue;
        const text =
            usefulText(record.text) ??
            usefulText(asRecord(record.extras)?.text);
        if (!text) continue;
        return {
            text,
            url: typeof record.url === "string" && record.url.trim() ? record.url : href,
            title: typeof record.title === "string" ? record.title : null,
        };
    }
    return null;
}
