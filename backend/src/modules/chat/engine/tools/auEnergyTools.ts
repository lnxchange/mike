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
1. If you already know the instrument id (for example esc:ercop, sa:nerl, or aemc:nerr), call au_get_energy with that id. Do not call au_search_energy first.
2. Search with au_search_energy only when you need an id.
3. Read with au_get_energy. The clause argument may be a clause number (71, 120B, 3) or a heading or defined term (Definitions, small customer). One get of the instrument plus that phrase is enough. Do not hunt with six tool rounds. If the definition only points to an Act, say so and continue the user's actual task.
4. For the instrument as it stood on a date, call au_get_energy_as_at with yyyy-mm-dd.
5. For version history, call au_energy_versions rather than fetching two full instruments.
6. After an instrument has been fetched in this turn, use au_find_in_energy for short 1-3 word probes. Maximum 3 searches per assistant turn.

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
- The server may retrieve official page or PDF text through Exa when the official host blocks a direct download. Cite the official URL returned in citationLinks, never Exa.
- Instruments already held in the background legislation repository are reused after a currency check against the official version list. If currency_status is unconfirmed, say that the held copy has not been confirmed as current.
- If any energy call reports that an official source is inaccessible (download failed, blocked, 403, or unavailable: true) and no held copy exists: stop further calls for that instrument. Do not invent the text. Tell the user which instrument could not be reached and its official URL. Call ask_inputs with one documents item whose id is the supplied legal_source_id (legal-source:energy:<instrumentId>) so they can upload the official compilation or the relevant extract. Other reachable official sources may still be used if they independently answer the question.
- If any energy call returns a rate-limit/throttling/429 error, stop all energy calls for that turn. Tell the user. Do not invent the missing text.`

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
                "Read the current official text of a Victorian energy instrument, national energy Law or adoption Act, AEMC rule book, AER guideline, or AEMO procedure. Pass a known id such as esc:ercop directly. Clause may be a number, heading, or defined term.",
            parameters: {
                type: "object",
                properties: {
                    instrumentId: {
                        type: "string",
                        description:
                            "Instrument id, e.g. esc:ercop or aemc:nerr. Use a known id directly; search only if you need one.",
                    },
                    clause: {
                        type: "string",
                        description:
                            "Clause number (71, 120B, 3), heading (Definitions), or defined term (small customer).",
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
                            "Instrument id, e.g. esc:ercop. Use a known id directly.",
                    },
                    date: {
                        type: "string",
                        description: "Point-in-time date as yyyy-mm-dd.",
                    },
                    clause: {
                        type: "string",
                        description:
                            "Clause number (71 or 3), heading (Definitions), or defined term (small customer).",
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
