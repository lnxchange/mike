export type { AuVicLegislationToolEvent } from "@mike/contracts";
import type { AuVicLegislationToolEvent } from "@mike/contracts";

export type { LegislationCitationEvent } from "@mike/contracts";

export const AU_VIC_LEGISLATION_TOOL_NAMES = {
    search: "au_search_vic_legislation",
    get: "au_get_vic_legislation",
    getAsAt: "au_get_vic_legislation_as_at",
    versions: "au_vic_legislation_versions",
    findIn: "au_find_in_vic_legislation",
} as const;

export const AU_VIC_LEGISLATION_SYSTEM_PROMPT = `AUSTRALIAN VICTORIAN LEGISLATION RESEARCH:
Use the Victorian legislation tools for Victorian Acts and statutory rules on legislation.vic.gov.au. The catalog includes energy, safety, consumer, procedure, and other in-force titles (for example the Electricity Industry Act 2000, National Electricity (Victoria) Act 2005, VCAT Act, and electric line clearance regulations). Other in-force titles can still be opened when the Tide slug matches.

Workflow:
1. Search with au_search_vic_legislation to obtain a title id (for example vic:electricity-industry-act-2000). Do not guess ids.
2. Read the current authorised compilation with au_get_vic_legislation. Prefer a section.
3. For the law as it stood on a date, call au_get_vic_legislation_as_at with yyyy-mm-dd.
4. For version history, call au_vic_legislation_versions rather than fetching two full Acts.
5. After a title has been fetched in this turn, use au_find_in_vic_legislation for short 1-3 word probes. Maximum 3 searches per assistant turn.

Citation rules:
- Final Victorian citations must be based on text supplied in this turn. Do not cite a section from memory, search results, or title metadata alone.
- If you mention a Victorian title as legal support, cite it with both: (a) the clickable markdown link returned in citationLinks, and (b) an inline [N] marker.
- The final <CITATIONS> block must include one matching legislation entry for each [N] Victorian marker: {"ref": N, "title_id": "vic:electricity-industry-act-2000", "quotes": [{"section": "40", "quote": "exact verbatim authorised text"}]}.
- Use official legislation.vic.gov.au or content.legislation.vic.gov.au URLs. Never AustLII.
- Victorian energy codes of practice (ERCOP and the distribution codes) are not Victorian statutes. Use the Australian energy tools for those.
- Commonwealth Acts and national energy rules are separate surfaces.

Limits:
- If any Victorian legislation call returns a rate-limit/throttling/429 error, stop all Victorian legislation calls for that turn and answer using only information already available.`;

export const AU_VIC_LEGISLATION_TOOLS = [
    {
        type: "function",
        function: {
            name: AU_VIC_LEGISLATION_TOOL_NAMES.search,
            description:
                "Search Victorian Acts and statutory rules on legislation.vic.gov.au by name or title id. Returns ids used by the other Victorian legislation tools.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description:
                            "Act name or id, e.g. Electricity Industry Act 2000 or vic:electricity-industry-act-2000.",
                    },
                    limit: {
                        type: "integer",
                        description: "Maximum number of titles to return. Default 10.",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_VIC_LEGISLATION_TOOL_NAMES.get,
            description:
                "Read the current authorised Victorian compilation. Prefer a section.",
            parameters: {
                type: "object",
                properties: {
                    titleId: {
                        type: "string",
                        description:
                            "Title id from au_search_vic_legislation, e.g. vic:electricity-industry-act-2000.",
                    },
                    section: {
                        type: "string",
                        description: "Section number, e.g. 40 or 40A.",
                    },
                    page: {
                        type: "integer",
                        description:
                            "1-based page when reading the whole title. Default 1.",
                    },
                },
                required: ["titleId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_VIC_LEGISLATION_TOOL_NAMES.getAsAt,
            description:
                "Read a Victorian title as it stood on a past date.",
            parameters: {
                type: "object",
                properties: {
                    titleId: {
                        type: "string",
                        description:
                            "Title id from au_search_vic_legislation, e.g. vic:electricity-industry-act-2000.",
                    },
                    date: {
                        type: "string",
                        description: "Point-in-time date as yyyy-mm-dd.",
                    },
                    section: {
                        type: "string",
                        description: "Section number, e.g. 40.",
                    },
                    page: {
                        type: "integer",
                        description:
                            "1-based page when reading the whole title. Default 1.",
                    },
                },
                required: ["titleId", "date"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_VIC_LEGISLATION_TOOL_NAMES.versions,
            description:
                "List official versions of a Victorian title.",
            parameters: {
                type: "object",
                properties: {
                    titleId: {
                        type: "string",
                        description:
                            "Title id from au_search_vic_legislation, e.g. vic:electricity-industry-act-2000.",
                    },
                },
                required: ["titleId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_VIC_LEGISLATION_TOOL_NAMES.findIn,
            description:
                "Search within a Victorian title already fetched in this turn. This tool does not fetch the title. Use no more than 3 calls in a single assistant turn.",
            parameters: {
                type: "object",
                properties: {
                    titleId: {
                        type: "string",
                        description:
                            "Title id previously fetched with au_get_vic_legislation or au_get_vic_legislation_as_at.",
                    },
                    query: {
                        type: "string",
                        description:
                            "Short term to search for, 1-3 words long and likely to appear exactly as written.",
                    },
                    date: {
                        type: "string",
                        description:
                            "Optional yyyy-mm-dd if the fetched version was an as-at compilation.",
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
