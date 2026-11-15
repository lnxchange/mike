export type OfficialSourceKind = "unavailable" | "not_found" | "invalid";

export type OfficialSourceAccess = {
    kind: OfficialSourceKind;
    officialUrl?: string;
};

export const OFFICIAL_SOURCE_NEXT_ACTION =
    "Stop further calls for this instrument. Tell the user the official source could not be reached. Call ask_inputs with one documents item whose id is the supplied legal_source_id (legal-source:<family>:<instrumentId>) requesting the official compilation or the relevant extract. Do not invent or recall the missing text. Other reachable official sources may still be used if they independently answer the question.";

const BLOCKED_STATUSES = new Set([401, 403, 429, 502, 503]);

export function isOfficialSourceUnavailableStatus(
    status?: number,
): boolean {
    return typeof status === "number" && BLOCKED_STATUSES.has(status);
}

export function officialSourceUnavailableMessage(args: {
    name: string;
    site?: string;
}): string {
    const site = args.site ? ` (${args.site})` : "";
    return (
        `I could not download the official text of ${args.name}${site}. ` +
        `The official source blocked or failed this request. ` +
        `I will not invent that text. Upload the official compilation or the relevant extract and I will continue from that.`
    );
}

export function looksLikeBotChallenge(bytes: Uint8Array): boolean {
    const head = Buffer.from(bytes.subarray(0, 1200)).toString("utf8");
    return /just a moment|cf-browser-verification|challenge-platform|attention required/i.test(
        head,
    );
}

export function inspectOfficialSourceError(err: unknown): {
    userMessage: string;
    officialUrl?: string;
} | null {
    if (!err || typeof err !== "object") return null;
    const row = err as {
        kind?: string;
        message?: string;
        officialUrl?: string;
        status?: number;
    };
    if (
        row.kind !== "unavailable" &&
        !isOfficialSourceUnavailableStatus(row.status)
    ) {
        return null;
    }
    const message =
        typeof row.message === "string" ? row.message.trim() : "";
    return {
        userMessage:
            message && !/^FRL API responded/i.test(message)
                ? message
                : officialSourceUnavailableMessage({
                      name: "this official source",
                  }),
        officialUrl:
            typeof row.officialUrl === "string" ? row.officialUrl : undefined,
    };
}

export function officialSourceToolFailure(
    err: unknown,
    fallback: string,
    extras?: { legalSourceId?: string },
): {
    error: string;
    safeToDisplay: boolean;
    content: string;
} {
    const access = inspectOfficialSourceError(err);
    if (access) {
        return {
            error: access.userMessage,
            safeToDisplay: true,
            content: JSON.stringify({
                error: access.userMessage,
                unavailable: true,
                official_url: access.officialUrl ?? null,
                legal_source_id: extras?.legalSourceId ?? null,
                next_required_action: OFFICIAL_SOURCE_NEXT_ACTION,
            }),
        };
    }
    const error = err instanceof Error ? err.message : fallback;
    return {
        error,
        safeToDisplay: false,
        content: JSON.stringify({ error }),
    };
}
