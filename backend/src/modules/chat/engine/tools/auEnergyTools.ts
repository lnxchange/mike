export type { AuEnergyToolEvent } from "@mike/contracts";
import type { AuEnergyToolEvent } from "@mike/contracts";

export type { LegislationCitationEvent } from "@mike/contracts";

export const AU_ENERGY_TOOL_NAMES = {
    search: "au_search_energy",
    get: "au_get_energy",
    getAsAt: "au_get_energy_as_at",
    versions: "au_energy_versions",
    findIn: "au_find_in_energy",
} as const;

export const AU_ENERGY_SYSTEM_PROMPT = `AUSTRALIAN ENERGY LAW RESEARCH:
Use the energy tools for Victorian energy codes and determinations, the national energy Laws and rule books, AER guidelines, AEMO procedures, and participating-jurisdiction adoption Acts. This includes the Essential Services Commission Energy Retail Code of Practice, Electricity Distribution Code of Practice, Gas Distribution Code of Practice, Victorian Default Offer, and Compliance and Performance Reporting Guideline; the National Energy Retail Law, National Electricity Law, and National Gas Law (South Australian host Acts) plus NSW, Queensland, and ACT adoption Acts; the AEMC National Energy Retail Rules, National Electricity Rules, and National Gas Rules; AER guidelines such as hardship, Better Bills, retailer authorisation, retail pricing information, retail compliance, and the Default Market Offer; and AEMO procedures such as B2B, MSATS, metering, and power system operating procedures.

Workflow:
1. Search with au_search_energy to obtain an instrument id (for example esc:ercop, aemc:nerr, sa:nerl, aer:hardship, or aemo:msats). Do not guess ids.
2. Read the current instrument with au_get_energy. Prefer a clause number (for example 71, 120B, or 3).
3. For the instrument as it stood on a date, call au_get_energy_as_at with yyyy-mm-dd.
4. For version history, call au_energy_versions rather than fetching two full instruments.
5. After an instrument has been fetched in this turn, use au_find_in_energy for short 1-3 word probes. Maximum 3 searches per assistant turn.

Citation rules:
- Final energy citations must be based on text supplied in this turn. Do not cite a clause from memory, search results, or title metadata alone.
- If you mention an energy instrument as legal support, cite it with both: (a) the clickable markdown link returned in citationLinks, and (b) an inline [N] marker.
- The final <CITATIONS> block must include one matching legislation entry for each [N] energy marker: {"ref": N, "title_id": "esc:ercop", "quotes": [{"section": "71(8)", "quote": "exact verbatim official text"}]}.
- Use official ESC, energy-rules.aemc.gov.au, aer.gov.au, aemo.com.au, or the official legislation sites for the host and adoption Acts. Never AustLII.
- The National Energy Retail Law (sa:nerl) and National Energy Retail Rules (aemc:nerr) are first-class instruments. Fetch the Law for NERL sections (for example hardship, authorisation, or civil penalties) and the Rules for NERR clauses. Also fetch the relevant adoption Act when the question is about how the Law applies in NSW, Queensland, or the ACT.
- Victoria has its own retail code. For Victorian retail customers, use the Energy Retail Code of Practice. Do not treat the NERR as applying in Victoria unless the question is a comparison or is about a participating jurisdiction. Never refuse to fetch the NERR.
- AER guidelines and AEMO procedures do not apply in Victoria merely because they exist nationally. Check the instrument's application before treating it as Victorian retail law.
- Victorian statutes and case law are separate research surfaces. Use those tools when they are available.

Limits:
- If any energy call returns a rate-limit/throttling/429 error, stop all energy calls for that turn and answer using only information already available.`;

export const AU_ENERGY_TOOLS = [
    {
        type: "function",
        function: {
            name: AU_ENERGY_TOOL_NAMES.search,
            description:
                "Search Victorian ESC energy instruments, national energy Laws and adoption Acts, AEMC rule books, AER guidelines, and AEMO procedures by name or instrument id. Returns ids used by the other energy tools.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description:
                            "Instrument name or id, e.g. Energy Retail Code of Practice, NERL, NERR, VDO, hardship, MSATS, esc:ercop, sa:nerl, or aer:hardship.",
                    },
                    limit: {
                        type: "integer",
                        description: "Maximum number of instruments to return. Default 10.",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_ENERGY_TOOL_NAMES.get,
            description:
                "Read the current official text of a Victorian energy instrument, national energy Law or adoption Act, AEMC rule book, AER guideline, or AEMO procedure. Prefer a clause or section.",
            parameters: {
                type: "object",
                properties: {
                    instrumentId: {
                        type: "string",
                        description:
                            "Instrument id from au_search_energy, e.g. esc:ercop or aemc:nerr.",
                    },
                    clause: {
                        type: "string",
                        description: "Clause or rule number, e.g. 71, 120B, or 3.",
                    },
                    page: {
                        type: "integer",
                        description:
                            "1-based page when reading the whole instrument. Default 1.",
                    },
                },
                required: ["instrumentId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_ENERGY_TOOL_NAMES.getAsAt,
            description:
                "Read a Victorian energy instrument, national energy Law or adoption Act, AEMC rule book, AER guideline, or AEMO procedure as it stood on a past date.",
            parameters: {
                type: "object",
                properties: {
                    instrumentId: {
                        type: "string",
                        description:
                            "Instrument id from au_search_energy, e.g. esc:ercop.",
                    },
                    date: {
                        type: "string",
                        description: "Point-in-time date as yyyy-mm-dd.",
                    },
                    clause: {
                        type: "string",
                        description: "Clause or rule number, e.g. 71 or 3.",
                    },
                    page: {
                        type: "integer",
                        description:
                            "1-based page when reading the whole instrument. Default 1.",
                    },
                },
                required: ["instrumentId", "date"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_ENERGY_TOOL_NAMES.versions,
            description:
                "List official versions of a Victorian energy instrument, national energy Law or adoption Act, AEMC rule book, AER guideline, or AEMO procedure.",
            parameters: {
                type: "object",
                properties: {
                    instrumentId: {
                        type: "string",
                        description:
                            "Instrument id from au_search_energy, e.g. esc:ercop.",
                    },
                },
                required: ["instrumentId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: AU_ENERGY_TOOL_NAMES.findIn,
            description:
                "Search within an energy instrument already fetched in this turn. This tool does not fetch the instrument. Use no more than 3 calls in a single assistant turn.",
            parameters: {
                type: "object",
                properties: {
                    instrumentId: {
                        type: "string",
                        description:
                            "Instrument id previously fetched with au_get_energy or au_get_energy_as_at.",
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
                required: ["instrumentId", "query"],
            },
        },
    },
];

export type { AuEnergyToolEvent };
