export type { AuCaseLawToolEvent } from "@mike/contracts";
import type { AuCaseLawToolEvent } from "@mike/contracts";

export type { LegislationCitationEvent } from "@mike/contracts";

export const AU_CASE_LAW_TOOL_NAMES = {
    search: "au_search_case_law",
    get: "au_get_case",
    findIn: "au_find_in_case",
} as const;

export const AU_CASE_LAW_SYSTEM_PROMPT = `AUSTRALIAN CASE LAW RESEARCH:
Use the Australian case-law tools for High Court, Federal Court, NSW Caselaw, and recent Supreme Court of Victoria PDFs published on supremecourt.vic.gov.au. Live requests go only to eresources.hcourt.gov.au, judgments.fedcourt.gov.au / search.judgments.fedcourt.gov.au, caselaw.nsw.gov.au, and supremecourt.vic.gov.au.

Workflow:
1. Search with au_search_case_law to obtain a case id (for example nsw:<decision-id>, hca:2024:12, or fca:[2024]FCA1). Do not guess ids.
2. Read the official judgment with au_get_case. Prefer a paragraph number.
3. After a judgment has been fetched in this turn, use au_find_in_case for short 1-3 word probes. Maximum 3 searches per assistant turn.

Citation rules:
- Final case citations must be based on text supplied in this turn. Do not cite a paragraph from memory, search results, or case metadata alone.
- If you mention a judgment as legal support, cite it with both: (a) the clickable markdown link returned in citationLinks, and (b) an inline [N] marker.
- The final <CITATIONS> block must include one matching legislation-shaped entry for each [N] case marker: {"ref": N, "title_id": "nsw:abc123", "quotes": [{"section": "42", "quote": "exact verbatim judgment text"}]}.
- Use official court URLs only. Never AustLII.
- For [YYYY] VSC or [YYYY] VSCA citations, search supremecourt.vic.gov.au for an official PDF. If none is there, say so. Do not use AustLII.
- US case law is a separate CourtListener surface.

Limits:
- The server may retrieve official judgment text through Exa when a court host blocks a direct download. Cite the official court URL, never Exa. Held copies in the background repository are reused.
- If any Australian case-law call reports that the official judgment is inaccessible (download failed, blocked, 403, or unavailable: true) and no held copy exists: stop further calls for that case. Do not invent the reasons. Tell the user which judgment could not be reached. Call ask_inputs with one documents item whose id is the supplied legal_source_id so they can upload the official judgment or the relevant extract.
- If any Australian case-law call returns a rate-limit/throttling/429 error, stop all Australian case-law calls for that turn. Tell the user. Do not invent the missing text.`

export const AU_CASE_LAW_TOOLS = [
    {
        type: "function",
        function: {
            name: AU_CASE_LAW_TOOL_NAMES.search,
            description:
                "Search official Australian judgments on NSW Caselaw, the Federal Court, High Court eresources, and recent Supreme Court of Victoria PDFs. Does not search AustLII.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description:
                            "Case name, medium-neutral citation, or issue, e.g. [2024] HCA 12 or electricity retailer.",
                    },
                    limit: {
                        type: "integer",
                        description: "Maximum number of cases to return. Default 10.",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_CASE_LAW_TOOL_NAMES.get,
            description:
                "Read an official High Court, Federal Court, or NSW Caselaw judgment. Prefer a paragraph.",
            parameters: {
                type: "object",
                properties: {
                    caseId: {
                        type: "string",
                        description:
                            "Case id from au_search_case_law, e.g. nsw:abc123, hca:2024:12, or [2024] HCA 12.",
                    },
                    paragraph: {
                        type: "string",
                        description: "Paragraph number, e.g. 42.",
                    },
                    page: {
                        type: "integer",
                        description:
                            "1-based page when reading the whole judgment. Default 1.",
                    },
                },
                required: ["caseId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_CASE_LAW_TOOL_NAMES.findIn,
            description:
                "Search within a judgment already fetched in this turn. This tool does not fetch the case. Use no more than 3 calls in a single assistant turn.",
            parameters: {
                type: "object",
                properties: {
                    caseId: {
                        type: "string",
                        description:
                            "Case id previously fetched with au_get_case.",
                    },
                    query: {
                        type: "string",
                        description:
                            "Short term to search for, 1-3 words long and likely to appear exactly as written.",
                    },
                    max_results: {
                        type: "integer",
                        description: "Maximum number of matches to return. Default 20.",
                    },
                    context_chars: {
                        type: "integer",
                        description:
                            "Characters of surrounding context on each side of each match. Default 160.",
                    },
                },
                required: ["caseId", "query"],
            },
        },
    },
];
