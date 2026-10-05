/**
 * Australian execution blocks for documents that will be signed.
 *
 * Generic Corporations Act content for every Australian practitioner.
 * No firm brand names or house style names belong here.
 */

export const EXECUTION_PARTY_KINDS = [
  "company",
  "company_sole_director",
  "company_two_directors",
  "individual",
  "partnership_authorised",
  "partnership_individuals",
  "company_trustee",
  "company_trustee_sole_director",
  "company_trustee_two_directors",
  "individual_trustee",
  "individual_trustees_multiple",
] as const;

export type ExecutionPartyKind = (typeof EXECUTION_PARTY_KINDS)[number];

export type ExecutionBlockId =
  | "01"
  | "02"
  | "03"
  | "04"
  | "05"
  | "06"
  | "07"
  | "08"
  | "09"
  | "10"
  | "11";

export type ExecutionRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
};

export type ExecutionLine = { runs: ExecutionRun[] };

export type ExecutionBlockRow = {
  left: ExecutionLine[];
  right: ExecutionLine[];
};

export type ExecutionPlaceholderValues = {
  companyName?: string;
  authorisedSignatoryName?: string;
  directorName?: string;
  director01Name?: string;
  director02Name?: string;
  individual?: string;
  individualName?: string;
  individual01Name?: string;
  individual02Name?: string;
  partnershipName?: string;
  partner01Name?: string;
  partner02Name?: string;
  trustName?: string;
  documentName?: string;
  authorisingDate?: string;
};

export type ExecutionPartySelection = {
  entity: "company" | "individual" | "partnership";
  trustee?: boolean;
  companyExecution?:
    | "authorised_signatory"
    | "sole_director"
    | "two_directors";
  partnershipExecution?: "authorised" | "individuals";
  individualTrusteeCount?: number;
};

export type ExecutionBlockDefinition = {
  id: ExecutionBlockId;
  label: string;
  party: ExecutionPartyKind;
  corporationsAct: "126" | "127" | null;
  requiresWitness: boolean;
  placeholders: readonly string[];
  rows: ExecutionBlockRow[];
};

const SIGNATURE_LINE = "_______________________________";

function line(...runs: ExecutionRun[]): ExecutionLine {
  return { runs };
}

function text(value: string, marks?: { bold?: boolean; italic?: boolean }): ExecutionRun {
  return { text: value, ...marks };
}

function executed(rest: ExecutionRun[]): ExecutionLine {
  return line(text("EXECUTED", { bold: true }), ...rest);
}

function signatory(nameToken: string, role?: string): ExecutionLine[] {
  const lines = [
    line(text(SIGNATURE_LINE)),
    line(text(nameToken, { bold: true })),
  ];
  if (role) lines.push(line(text(role)));
  lines.push(line(text("Date")));
  return lines;
}

function witnessBlock(): ExecutionLine[] {
  return [
    line(text("In the presence of:", { bold: true })),
    line(text(SIGNATURE_LINE, { bold: true })),
    line(text("Witness Signature", { bold: true })),
    line(text("Date", { bold: true })),
    line(text(SIGNATURE_LINE, { bold: true })),
    line(text("Witness Name (print)", { bold: true })),
  ];
}

function act126(prefix: ExecutionRun[], suffix: string): ExecutionLine {
  return executed([
    ...prefix,
    text(" in accordance with clause 126 of the "),
    text("Corporations Act 2001", { italic: true }),
    text(` (Cth)${suffix}`),
  ]);
}

function act127(prefix: ExecutionRun[]): ExecutionLine {
  return executed([
    ...prefix,
    text(" in accordance with clause 127 of the "),
    text("Corporations Act 2001", { italic: true }),
    text(" (Cth) by:"),
  ]);
}

export const EXECUTION_BLOCKS: readonly ExecutionBlockDefinition[] = [
  {
    id: "01",
    label: "Authorised Signatory",
    party: "company",
    corporationsAct: "126",
    requiresWitness: false,
    placeholders: ["#COMPANY PTY LTD", "#AuthorisedSignatoryName"],
    rows: [
      {
        left: [
          act126(
            [
              text(" on behalf of "),
              text("#COMPANY PTY LTD", { bold: true }),
            ],
            " by its authorised representative:",
          ),
        ],
        right: signatory("#AuthorisedSignatoryName"),
      },
    ],
  },
  {
    id: "02",
    label: "Sole Director",
    party: "company_sole_director",
    corporationsAct: "127",
    requiresWitness: false,
    placeholders: ["#COMPANY PTY LTD", "#DirectorName"],
    rows: [
      {
        left: [
          act127([text(" by "), text("#COMPANY PTY LTD", { bold: true })]),
        ],
        right: signatory("#DirectorName", "Sole Director"),
      },
    ],
  },
  {
    id: "03",
    label: "2 Directors",
    party: "company_two_directors",
    corporationsAct: "127",
    requiresWitness: false,
    placeholders: ["#COMPANY PTY LTD", "#Director01Name", "#Director02Name"],
    rows: [
      {
        left: [
          act127([text(" by "), text("#COMPANY PTY LTD", { bold: true })]),
        ],
        right: [
          ...signatory("#Director01Name", "Director"),
          ...signatory("#Director02Name", "Director/Secretary"),
        ],
      },
    ],
  },
  {
    id: "04",
    label: "Individual",
    party: "individual",
    corporationsAct: null,
    requiresWitness: true,
    placeholders: ["#INDIVIDUAL", "#IndividualName"],
    rows: [
      {
        left: [
          executed([
            text(" by "),
            text("#INDIVIDUAL", { bold: true }),
            text(" by:"),
          ]),
        ],
        right: [...signatory("#IndividualName"), ...witnessBlock()],
      },
    ],
  },
  {
    id: "05",
    label: "Authorised Partner",
    party: "partnership_authorised",
    corporationsAct: null,
    requiresWitness: false,
    placeholders: [
      "#PartnershipName",
      "#DocumentName",
      "#Date",
      "#AuthorisedSignatoryName",
    ],
    rows: [
      {
        left: [
          executed([
            text(" on behalf of "),
            text("#PartnershipName", { bold: true }),
            text(" by its authorised representative pursuant to #DocumentName dated #Date:"),
          ]),
        ],
        right: signatory("#AuthorisedSignatoryName"),
      },
    ],
  },
  {
    id: "06",
    label: "Individual Partners",
    party: "partnership_individuals",
    corporationsAct: null,
    requiresWitness: true,
    placeholders: ["#PARTNERSHIP NAME", "#Partner01Name", "#Partner02Name"],
    rows: [
      {
        left: [
          executed([
            text(" by on behalf of "),
            text("#PARTNERSHIP NAME", { bold: true }),
            text(" by:"),
          ]),
        ],
        right: [
          ...signatory("#Partner01Name"),
          ...witnessBlock(),
          ...signatory("#Partner02Name"),
          ...witnessBlock(),
        ],
      },
    ],
  },
  {
    id: "07",
    label: "Authorised Signatory Trustee Company",
    party: "company_trustee",
    corporationsAct: "126",
    requiresWitness: false,
    placeholders: [
      "#COMPANY PTY LTD",
      "#TRUST NAME",
      "#AuthorisedSignatoryName",
    ],
    rows: [
      {
        left: [
          act126(
            [
              text(" on behalf of "),
              text("#COMPANY PTY LTD", { bold: true }),
              text(" as trustee for "),
              text("#TRUST NAME", { bold: true }),
            ],
            " by its authorised representative:",
          ),
        ],
        right: signatory("#AuthorisedSignatoryName"),
      },
    ],
  },
  {
    id: "08",
    label: "Sole Director Trustee Company",
    party: "company_trustee_sole_director",
    corporationsAct: "127",
    requiresWitness: false,
    placeholders: ["#COMPANY PTY LTD", "#TRUST NAME", "#DirectorName"],
    rows: [
      {
        left: [
          act127([
            text(" by "),
            text("#COMPANY PTY LTD", { bold: true }),
            text(" as trustee for "),
            text("#TRUST NAME", { bold: true }),
          ]),
        ],
        right: signatory("#DirectorName", "Sole Director"),
      },
    ],
  },
  {
    id: "09",
    label: "2 Director Trustee Company",
    party: "company_trustee_two_directors",
    corporationsAct: "127",
    requiresWitness: false,
    placeholders: [
      "#COMPANY PTY LTD",
      "#TRUST NAME",
      "#Director01Name",
      "#Director02Name",
    ],
    rows: [
      {
        left: [
          act127([
            text(" by "),
            text("#COMPANY PTY LTD", { bold: true }),
            text(" as trustee for "),
            text("#TRUST NAME", { bold: true }),
          ]),
        ],
        right: [
          ...signatory("#Director01Name", "Director"),
          ...signatory("#Director02Name", "Director/Secretary"),
        ],
      },
    ],
  },
  {
    id: "10",
    label: "Individual Trustee",
    party: "individual_trustee",
    corporationsAct: null,
    requiresWitness: true,
    placeholders: ["#TRUST NAME", "#Individual01Name"],
    rows: [
      {
        left: [
          executed([
            text(" as sole trustee of "),
            text("#TRUST NAME", { bold: true }),
            text(" by:"),
          ]),
        ],
        right: signatory("#Individual01Name"),
      },
      {
        left: [line(text("In the presence of:", { bold: true }))],
        right: [
          line(text(SIGNATURE_LINE)),
          line(text("Witness Signature")),
          line(text("Date")),
          line(text(SIGNATURE_LINE)),
          line(text("Witness Name (print)")),
        ],
      },
    ],
  },
  {
    id: "11",
    label: "Multiple Individual Trustees",
    party: "individual_trustees_multiple",
    corporationsAct: null,
    requiresWitness: true,
    placeholders: ["#TRUST NAME", "#Individual01Name", "#Individual02Name"],
    rows: [
      {
        left: [
          executed([
            text(" as trustees of "),
            text("#TRUST NAME", { bold: true }),
            text(" by:"),
          ]),
        ],
        right: [
          ...signatory("#Individual01Name"),
          ...witnessBlock(),
          ...signatory("#Individual02Name"),
          ...witnessBlock(),
        ],
      },
    ],
  },
];

const BLOCK_BY_PARTY = new Map(
  EXECUTION_BLOCKS.map((block) => [block.party, block]),
);
const BLOCK_BY_ID = new Map(EXECUTION_BLOCKS.map((block) => [block.id, block]));

const TOKEN_VALUES: { token: string; key: keyof ExecutionPlaceholderValues }[] =
  [
    { token: "#COMPANY PTY LTD", key: "companyName" },
    { token: "#AuthorisedSignatoryName", key: "authorisedSignatoryName" },
    { token: "#Director01Name", key: "director01Name" },
    { token: "#Director02Name", key: "director02Name" },
    { token: "#DirectorName", key: "directorName" },
    { token: "#INDIVIDUAL", key: "individual" },
    { token: "#Individual01Name", key: "individual01Name" },
    { token: "#Individual02Name", key: "individual02Name" },
    { token: "#IndividualName", key: "individualName" },
    { token: "#PartnershipName", key: "partnershipName" },
    { token: "#PARTNERSHIP NAME", key: "partnershipName" },
    { token: "#Partner01Name", key: "partner01Name" },
    { token: "#Partner02Name", key: "partner02Name" },
    { token: "#TRUST NAME", key: "trustName" },
    { token: "#DocumentName", key: "documentName" },
    { token: "#Date", key: "authorisingDate" },
  ];

export function isAustralianJurisdiction(
  value: string | null | undefined,
): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "australia";
}

export function resolveExecutionPartyKind(
  input: ExecutionPartySelection,
): ExecutionPartyKind {
  if (input.entity === "company") {
    if (input.trustee) {
      if (input.companyExecution === "sole_director") {
        return "company_trustee_sole_director";
      }
      if (input.companyExecution === "two_directors") {
        return "company_trustee_two_directors";
      }
      return "company_trustee";
    }
    if (input.companyExecution === "sole_director") return "company_sole_director";
    if (input.companyExecution === "two_directors") return "company_two_directors";
    return "company";
  }
  if (input.entity === "partnership") {
    return input.partnershipExecution === "individuals"
      ? "partnership_individuals"
      : "partnership_authorised";
  }
  if (input.trustee) {
    return (input.individualTrusteeCount ?? 1) > 1
      ? "individual_trustees_multiple"
      : "individual_trustee";
  }
  return "individual";
}

export function selectExecutionBlock(
  input: ExecutionPartyKind | ExecutionPartySelection | { id: ExecutionBlockId },
): ExecutionBlockDefinition {
  if (typeof input === "string") {
    const block = BLOCK_BY_PARTY.get(input);
    if (!block) {
      throw new Error(`Unknown execution party kind: ${input}`);
    }
    return block;
  }
  if ("id" in input) {
    const block = BLOCK_BY_ID.get(input.id);
    if (!block) {
      throw new Error(`Unknown execution block id: ${input.id}`);
    }
    return block;
  }
  return selectExecutionBlock(resolveExecutionPartyKind(input));
}

function fillText(value: string, placeholders?: ExecutionPlaceholderValues): string {
  if (!placeholders) return value;
  let next = value;
  for (const { token, key } of TOKEN_VALUES) {
    const replacement = placeholders[key];
    if (replacement) next = next.split(token).join(replacement);
  }
  return next;
}

function fillLines(
  lines: ExecutionLine[],
  placeholders?: ExecutionPlaceholderValues,
): ExecutionLine[] {
  return lines.map((lineItem) => ({
    runs: lineItem.runs.map((run) => ({
      ...run,
      text: fillText(run.text, placeholders),
    })),
  }));
}

export function fillExecutionBlock(
  block: ExecutionBlockDefinition,
  placeholders?: ExecutionPlaceholderValues,
): ExecutionBlockDefinition {
  return {
    ...block,
    rows: block.rows.map((row) => ({
      left: fillLines(row.left, placeholders),
      right: fillLines(row.right, placeholders),
    })),
  };
}

function linesToPlain(lines: ExecutionLine[]): string {
  return lines
    .map((lineItem) => lineItem.runs.map((run) => run.text).join(""))
    .join("\n");
}

export function renderExecutionBlockMarkdown(
  block: ExecutionBlockDefinition,
  placeholders?: ExecutionPlaceholderValues,
): string {
  const filled = fillExecutionBlock(block, placeholders);
  const rows = filled.rows
    .map((row) => {
      const left = linesToPlain(row.left).replace(/\n/g, "<br>");
      const right = linesToPlain(row.right).replace(/\n/g, "<br>");
      return `| ${left} | ${right} |`;
    })
    .join("\n");
  return [`[${filled.id} - ${filled.label}]`, "", "|  |  |", "| --- | --- |", rows].join(
    "\n",
  );
}

export function renderExecutionCatalogMarkdown(): string {
  return EXECUTION_BLOCKS.map((block) =>
    renderExecutionBlockMarkdown(block),
  ).join("\n\n");
}

export const AU_EXECUTION_BLOCKS_PROMPT = `AUSTRALIAN EXECUTION BLOCKS:
When generating or editing a document that will be signed under Australian law, do not hand-draft signature lines such as By, Name, Title, and Date. Select one canonical block per signing party and insert that block.

Select by party type:
- Company (default): [01 - Authorised Signatory] (Corporations Act s126, authorised representative). Use this unless the company will actually execute by its directors.
- Company, sole director: [02 - Sole Director] (s127).
- Company, two directors or director and secretary: [03 - 2 Directors] (s127).
- Individual: [04 - Individual], with a witness.
- Partnership, authorised representative: [05 - Authorised Partner], naming the authorising document and its date.
- Partnership, individual partners signing: [06 - Individual Partners], each partner with a witness.
- Company as trustee (default): [07 - Authorised Signatory Trustee Company] (s126). Name the trust.
- Company as trustee, sole director: [08 - Sole Director Trustee Company] (s127).
- Company as trustee, two directors: [09 - 2 Director Trustee Company] (s127).
- Individual trustee, sole: [10 - Individual Trustee], with a witness.
- Individual trustees, multiple: [11 - Multiple Individual Trustees], each with a witness.

Rules:
- One block per signing party, matched to that party's type.
- s126 is execution by an authorised representative. s127 is execution by the company's director(s) or secretary. Choose by how the party will sign.
- Trustee parties must name the trust ("as trustee for" the trust).
- Witness blocks are required for individuals and individual trustees ([04], [06], [10], [11]). Company executions do not take a witness.
- Always render the block as a borderless two-column table (no visible gridlines).
- Replace every # token before finalising. Leave the signature line, Date, and witness fields blank for wet or e-signature.
- Tokens: #COMPANY PTY LTD, #AuthorisedSignatoryName, #DirectorName, #Director01Name, #Director02Name, #INDIVIDUAL, #IndividualName, #Individual01Name, #Individual02Name, #PartnershipName, #PARTNERSHIP NAME, #Partner01Name, #Partner02Name, #TRUST NAME, #DocumentName, #Date (authorising document date only).

When calling generate_docx, put the execution section on a fresh page (pageBreak: true) and pass executionBlocks, one object per signing party, using party plus any known placeholder values. Do not invent a different signature layout.
When editing an existing document, insert the matching block below as a borderless two-column table. Do not type a freehand signature block.

Canonical blocks (render borderless):

${renderExecutionCatalogMarkdown()}`;

export function withAuExecutionBlocksPrompt(
  extra: string | undefined,
  jurisdiction: string | null | undefined,
): string | undefined {
  if (!isAustralianJurisdiction(jurisdiction)) return extra;
  return extra
    ? `${extra}\n\n${AU_EXECUTION_BLOCKS_PROMPT}`
    : AU_EXECUTION_BLOCKS_PROMPT;
}
