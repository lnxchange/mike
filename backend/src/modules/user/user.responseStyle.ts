// How the user wants assistant answers written, from Settings > Personalisation.
// Stored as one JSON object of the choices that differ from the default.
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import { type Db } from "./user.shared";

export const RESPONSE_STYLE_OPTIONS = {
    verbosity: ["concise", "balanced", "detailed"],
    formatting: ["balanced", "less", "more"],
    tone: ["formal", "balanced", "plain"],
} as const;

type Options = typeof RESPONSE_STYLE_OPTIONS;
export type ResponseStyleField = keyof Options;
export type ResponseStyle = {
    [Field in ResponseStyleField]: Options[Field][number];
};

export const DEFAULT_RESPONSE_STYLE: ResponseStyle = {
    verbosity: "balanced",
    formatting: "balanced",
    tone: "balanced",
};

const COLUMN = "response_style";
const MERGE_FUNCTION = "merge_user_response_style";
const FIELDS = Object.keys(DEFAULT_RESPONSE_STYLE) as ResponseStyleField[];

function isOption<Field extends ResponseStyleField>(
    field: Field,
    value: unknown,
): value is ResponseStyle[Field] {
    return (
        typeof value === "string" &&
        (RESPONSE_STYLE_OPTIONS[field] as readonly string[]).includes(value)
    );
}

function errorCode(error: unknown): string {
    const code =
        error && typeof error === "object"
            ? (error as { code?: unknown }).code
            : undefined;
    return typeof code === "string" ? code : "";
}

function errorText(error: unknown): string {
    const message =
        error && typeof error === "object"
            ? (error as { message?: unknown }).message
            : undefined;
    return typeof message === "string" ? message : "";
}

/** The column or the merge function is not there yet. */
function isNotMigrated(error: unknown): boolean {
    const text = errorText(error);
    const code = errorCode(error);
    return (
        ((code === "42703" || code === "PGRST204") && text.includes(COLUMN)) ||
        ((code === "PGRST202" || code === "42883") &&
            text.includes(MERGE_FUNCTION))
    );
}

function toResponseStyle(stored: unknown): ResponseStyle {
    const record =
        stored && typeof stored === "object" && !Array.isArray(stored)
            ? (stored as Record<string, unknown>)
            : {};
    const style = { ...DEFAULT_RESPONSE_STYLE };
    for (const field of FIELDS) {
        const value = record[field];
        if (isOption(field, value)) {
            (style as Record<ResponseStyleField, string>)[field] = value;
        }
    }
    return style;
}

export async function loadResponseStyle(
    db: Db,
    userId: string,
): Promise<ResponseStyle> {
    const { data, error } = await db
        .from("user_profiles")
        .select(COLUMN)
        .eq("user_id", userId)
        .maybeSingle();
    if (error) {
        if (isNotMigrated(error)) return DEFAULT_RESPONSE_STYLE;
        throw error;
    }
    return toResponseStyle(
        (data as { response_style?: unknown } | null)?.response_style,
    );
}

export async function getResponseStyle(
    db: Db,
    userId: string,
): Promise<ServiceResult<ResponseStyle>> {
    try {
        return ok(await loadResponseStyle(db, userId));
    } catch (error) {
        return internalFailure(error);
    }
}

export function validateResponseStylePayload(
    body: unknown,
):
    | { ok: true; update: Partial<ResponseStyle> }
    | { ok: false; detail: string } {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { ok: false, detail: "Expected a JSON object" };
    }
    const raw = body as Record<string, unknown>;
    const keys = Object.keys(raw);
    const invalidField = keys.find(
        (key) => !(FIELDS as string[]).includes(key),
    );
    if (invalidField) {
        return {
            ok: false,
            detail: `Unsupported response style field: ${invalidField}`,
        };
    }
    if (keys.length === 0) {
        return {
            ok: false,
            detail: "Expected at least one response style field",
        };
    }
    const update: Partial<ResponseStyle> = {};
    for (const field of keys as ResponseStyleField[]) {
        const value = raw[field];
        if (!isOption(field, value)) {
            return {
                ok: false,
                detail: `${field} must be one of: ${RESPONSE_STYLE_OPTIONS[field].join(", ")}`,
            };
        }
        (update as Record<ResponseStyleField, string>)[field] = value;
    }
    return { ok: true, update };
}

function toStoredPatch(
    update: Partial<ResponseStyle>,
): Record<string, string | null> {
    const patch: Record<string, string | null> = {};
    for (const field of FIELDS) {
        const value = update[field];
        if (value === undefined) continue;
        patch[field] = value === DEFAULT_RESPONSE_STYLE[field] ? null : value;
    }
    return patch;
}

export async function saveResponseStyle(
    db: Db,
    userId: string,
    update: Partial<ResponseStyle>,
): Promise<ServiceResult<ResponseStyle>> {
    const { data, error } = await db.rpc(MERGE_FUNCTION, {
        p_user_id: userId,
        p_patch: toStoredPatch(update),
    });
    if (error) {
        if (isNotMigrated(error)) {
            return failure(
                "unavailable",
                "Response style is not available yet.",
            );
        }
        return internalFailure(error);
    }
    if (data == null) return failure("not_found", "Profile not found");
    return ok(toResponseStyle(data));
}
