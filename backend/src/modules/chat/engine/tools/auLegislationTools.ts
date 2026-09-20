export type { AuLegislationToolEvent } from "@mike/contracts";
import type { AuLegislationToolEvent } from "@mike/contracts";

export type { LegislationCitationEvent } from "@mike/contracts";
import type { LegislationCitationEvent } from "@mike/contracts";

export const AU_LEGISLATION_TOOL_NAMES = {
    search: "au_search_legislation",
    get: "au_get_legislation",
    getAsAt: "au_get_legislation_as_at",
    versions: "au_legislation_versions",
    findIn: "au_find_in_legislation",
} as const;

export const AU_LEGISLATION_SYSTEM_PROMPT = `AUSTRALIAN COMMONWEALTH LEGISLATION RESEARCH:
Use the Federal Register of Legislation tools when answering questions about Commonwealth Acts or legislative instruments.

Workflow:
1. Search with au_search_legislation to obtain a title id (for example C2004A03348 or F2019L00196). Do not guess title ids.
2. Read the current compilation with au_get_legislation. Prefer a section or schedule. If the whole title is needed, page through it.
3. For the law as it stood on a date, call au_get_legislation_as_at with yyyy-mm-dd.
4. For amendment history or "what changed", call au_legislation_versions rather than fetching two full Acts.
5. After a title has been fetched in this turn, use au_find_in_legislation for short 1-3 word probes. Maximum 3 searches per assistant turn.

Citation rules:
- Final legislation citations must be based on text or snippets supplied in this turn. Do not cite a provision from memory, search results, or title metadata alone.
- If you mention a Register title as legal support, cite it with both: (a) the clickable markdown link returned in citationLinks, and (b) an inline [N] marker. Include the clickable link only the first time you cite that compilation.
- Assign new annotation refs in first-use order: [1], then [2], then [3]. Reuse an existing ref when citing the same title or passage again.
- The final <CITATIONS> block must include one matching legislation entry for each [N] legislation marker: {"ref": N, "title_id": "C2004A03348", "quotes": [{"section": "18", "quote": "exact verbatim register text"}]}.
- Do not use doc_id, cluster_id, page, case_name, or AustLII URLs in legislation entries.
- Attribute Commonwealth material as CC BY 4.0. Never fetch or cite austlii.edu.au.
- This research surface is Commonwealth legislation only. For Victorian energy codes, AEMC rules, AER guidelines, and AEMO procedures, use the Australian energy tools when they are available. For Victorian statutes, use the Victorian legislation tools. For Australian judgments, use the Australian case-law tools.

Limits:
- If any Federal Register call returns a rate-limit/throttling/429 error, stop all AU legislation calls for that turn and answer using only information already available.`;

export const AU_LEGISLATION_TOOLS = [
    {
        type: "function",
        function: {
            name: AU_LEGISLATION_TOOL_NAMES.search,
            description:
                "Search the Federal Register of Legislation for Commonwealth Acts and legislative instruments by name or Register ID. Returns title ids used by the other AU legislation tools.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description:
                            "Act or instrument name, short title, or Register ID such as C2004A03348.",
                    },
                    limit: {
                        type: "integer",
                        description: "Maximum number of titles to return. Default 10, maximum 50.",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_LEGISLATION_TOOL_NAMES.get,
            description:
                "Read the current compilation of a Commonwealth title from the Federal Register. Prefer a section or schedule. Without a section, returns a table of provisions and one page of text.",
            parameters: {
                type: "object",
                properties: {
                    titleId: {
                        type: "string",
                        description:
                            "Register title id from au_search_legislation, e.g. C2004A03348.",
                    },
                    section: {
                        type: "string",
                        description:
                            "Section, regulation, or schedule to read, e.g. 18, s 21, or Schedule 2.",
                    },
                    page: {
                        type: "integer",
                        description:
                            "1-based page of provisions when reading the whole title. Default 1.",
                    },
                },
                required: ["titleId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_LEGISLATION_TOOL_NAMES.getAsAt,
            description:
                "Read a Commonwealth title as it stood on a past date, using the compilation whose in-force window covers that day.",
            parameters: {
                type: "object",
                properties: {
                    titleId: {
                        type: "string",
                        description:
                            "Register title id from au_search_legislation, e.g. C2004A03348.",
                    },
                    date: {
                        type: "string",
                        description: "Point-in-time date as yyyy-mm-dd.",
                    },
                    section: {
                        type: "string",
                        description:
                            "Section, regulation, or schedule to read, e.g. 18 or Schedule 2.",
                    },
                    page: {
                        type: "integer",
                        description:
                            "1-based page of provisions when reading the whole title. Default 1.",
                    },
                },
                required: ["titleId", "date"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_LEGISLATION_TOOL_NAMES.versions,
            description:
                "List compilations and amendment notes for a Commonwealth title so you can say what changed without fetching two full Acts.",
            parameters: {
                type: "object",
                properties: {
                    titleId: {
                        type: "string",
                        description:
                            "Register title id from au_search_legislation, e.g. C2004A03348.",
                    },
                    limit: {
                        type: "integer",
                        description:
                            "Maximum number of compilations to return. Default 20, maximum 100.",
                    },
                },
                required: ["titleId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_LEGISLATION_TOOL_NAMES.findIn,
            description:
                "Search within a Commonwealth title already fetched in this turn. This tool does not fetch legislation. Use no more than 3 calls in a single assistant turn.",
            parameters: {
                type: "object",
                properties: {
                    titleId: {
                        type: "string",
                        description:
                            "Register title id previously fetched with au_get_legislation or au_get_legislation_as_at.",
                    },
                    query: {
                        type: "string",
                        description:
                            "Short term to search for, 1-3 words long and likely to appear exactly as written.",
                    },
                    date: {
                        type: "string",
                        description:
                            "Optional yyyy-mm-dd if the fetched compilation was an as-at version.",
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
                required: ["titleId", "query"],
            },
        },
    },
];
