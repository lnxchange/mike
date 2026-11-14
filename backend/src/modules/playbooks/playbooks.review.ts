export type PlaybookRule = {
    id: string;
    name: string;
    concept: string;
    required: boolean;
    standard: string;
    fallbacks: string[];
    unacceptable: string[];
    guidance: string;
};

export type PlaybookContent = { rules: PlaybookRule[] };

export type PlaybookFinding = {
    ruleId: string | null;
    ruleName: string;
    status:
        | "not_applicable"
        | "acceptable"
        | "needs_review"
        | "unacceptable"
        | "missing_required";
    quote: string;
    location: string;
    analysis: string;
    suggestedText: string;
};

const STATUSES = new Set<PlaybookFinding["status"]>([
    "not_applicable",
    "acceptable",
    "needs_review",
    "unacceptable",
    "missing_required",
]);

export function emptyPlaybook(): PlaybookContent {
    return {
        rules: [
            {
                id: "rule-1",
                name: "New rule",
                concept: "Replace this with the clause you are reviewing.",
                required: true,
                standard: "",
                fallbacks: [],
                unacceptable: [],
                guidance: "",
            },
        ],
    };
}

export function reviewPrompt(
    content: PlaybookContent,
    documentText: string,
    mode: "strict" | "permissive",
): string {
    return `Review the full contract against the playbook. Apply unacceptable positions first. In strict mode, fallback matches still need review. In permissive mode, a fallback may be acceptable but explain which fallback applies. Flag a missing required rule as missing_required. Use not_applicable only when an optional concept is absent. Quote exact contract text. suggestedText must be a complete replacement for quote, or the complete clause to insert for missing_required. Do not suggest an edit for acceptable or not_applicable findings. Do not invent contract language or findings.

Return JSON only:
{"summary":"","findings":[{"ruleId":"rule-1|null","ruleName":"","status":"not_applicable|acceptable|needs_review|unacceptable|missing_required","quote":"exact contract text or empty when missing","location":"section or heading","analysis":"","suggestedText":""}]}

REVIEW MODE: ${mode}
PLAYBOOK:
${JSON.stringify(content).slice(0, 100_000)}

CONTRACT:
${documentText.slice(0, 180_000)}`;
}

export function parseReviewJson(
    text: string,
): { summary: string; findings: unknown[] } | null {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const source = fenced?.[1] ?? text;
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
        const parsed = JSON.parse(source.slice(start, end + 1)) as {
            summary?: unknown;
            findings?: unknown;
        };
        return {
            summary: typeof parsed.summary === "string" ? parsed.summary : "",
            findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        };
    } catch {
        return null;
    }
}

function asFinding(value: unknown): PlaybookFinding | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const status = row.status;
    if (typeof status !== "string" || !STATUSES.has(status as PlaybookFinding["status"])) {
        return null;
    }
    return {
        ruleId: typeof row.ruleId === "string" ? row.ruleId : null,
        ruleName: typeof row.ruleName === "string" ? row.ruleName : "",
        status: status as PlaybookFinding["status"],
        quote: typeof row.quote === "string" ? row.quote.trim() : "",
        location: typeof row.location === "string" ? row.location : "",
        analysis: typeof row.analysis === "string" ? row.analysis : "",
        suggestedText:
            typeof row.suggestedText === "string" ? row.suggestedText : "",
    };
}

/** Drop a quote the model did not take from the contract. */
export function normalizeFindings(
    documentText: string,
    findings: unknown[],
): PlaybookFinding[] {
    const kept: PlaybookFinding[] = [];
    for (const value of findings) {
        const finding = asFinding(value);
        if (!finding) continue;
        if (finding.status === "missing_required") {
            kept.push({ ...finding, quote: "" });
            continue;
        }
        if (!finding.quote || !documentText.includes(finding.quote)) continue;
        if (
            finding.status === "acceptable" ||
            finding.status === "not_applicable"
        ) {
            kept.push({ ...finding, suggestedText: "" });
            continue;
        }
        kept.push(finding);
    }
    return kept;
}
