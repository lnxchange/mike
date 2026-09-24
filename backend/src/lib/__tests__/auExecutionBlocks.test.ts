import { describe, expect, it } from "vitest";
import {
  AU_EXECUTION_BLOCKS_PROMPT,
  EXECUTION_BLOCKS,
  fillExecutionBlock,
  isAustralianJurisdiction,
  renderExecutionBlockMarkdown,
  resolveExecutionPartyKind,
  selectExecutionBlock,
  withAuExecutionBlocksPrompt,
  type ExecutionPartyKind,
  type ExecutionPartySelection,
} from "../auExecutionBlocks";

const SELECTION_CASES: {
  input: ExecutionPartySelection;
  party: ExecutionPartyKind;
  id: string;
  witness: boolean;
  act: "126" | "127" | null;
}[] = [
  {
    input: { entity: "company" },
    party: "company",
    id: "01",
    witness: false,
    act: "126",
  },
  {
    input: { entity: "company", companyExecution: "authorised_signatory" },
    party: "company",
    id: "01",
    witness: false,
    act: "126",
  },
  {
    input: { entity: "company", companyExecution: "sole_director" },
    party: "company_sole_director",
    id: "02",
    witness: false,
    act: "127",
  },
  {
    input: { entity: "company", companyExecution: "two_directors" },
    party: "company_two_directors",
    id: "03",
    witness: false,
    act: "127",
  },
  {
    input: { entity: "individual" },
    party: "individual",
    id: "04",
    witness: true,
    act: null,
  },
  {
    input: { entity: "partnership" },
    party: "partnership_authorised",
    id: "05",
    witness: false,
    act: null,
  },
  {
    input: { entity: "partnership", partnershipExecution: "authorised" },
    party: "partnership_authorised",
    id: "05",
    witness: false,
    act: null,
  },
  {
    input: { entity: "partnership", partnershipExecution: "individuals" },
    party: "partnership_individuals",
    id: "06",
    witness: true,
    act: null,
  },
  {
    input: { entity: "company", trustee: true },
    party: "company_trustee",
    id: "07",
    witness: false,
    act: "126",
  },
  {
    input: {
      entity: "company",
      trustee: true,
      companyExecution: "sole_director",
    },
    party: "company_trustee_sole_director",
    id: "08",
    witness: false,
    act: "127",
  },
  {
    input: {
      entity: "company",
      trustee: true,
      companyExecution: "two_directors",
    },
    party: "company_trustee_two_directors",
    id: "09",
    witness: false,
    act: "127",
  },
  {
    input: { entity: "individual", trustee: true },
    party: "individual_trustee",
    id: "10",
    witness: true,
    act: null,
  },
  {
    input: { entity: "individual", trustee: true, individualTrusteeCount: 1 },
    party: "individual_trustee",
    id: "10",
    witness: true,
    act: null,
  },
  {
    input: { entity: "individual", trustee: true, individualTrusteeCount: 2 },
    party: "individual_trustees_multiple",
    id: "11",
    witness: true,
    act: null,
  },
];

describe("resolveExecutionPartyKind", () => {
  it.each(SELECTION_CASES)(
    "selects $id for $party",
    ({ input, party }) => {
      expect(resolveExecutionPartyKind(input)).toBe(party);
    },
  );

  it("defaults a company to the s126 authorised signatory block", () => {
    expect(resolveExecutionPartyKind({ entity: "company" })).toBe("company");
    expect(selectExecutionBlock({ entity: "company" }).id).toBe("01");
  });
});

describe("selectExecutionBlock", () => {
  it.each(SELECTION_CASES)(
    "returns block $id with the matching witness and Act rules",
    ({ input, id, witness, act, party }) => {
      const block = selectExecutionBlock(input);
      expect(block.id).toBe(id);
      expect(block.party).toBe(party);
      expect(block.requiresWitness).toBe(witness);
      expect(block.corporationsAct).toBe(act);
    },
  );

  it("accepts a party kind or a block id", () => {
    expect(selectExecutionBlock("individual").id).toBe("04");
    expect(selectExecutionBlock({ id: "03" }).label).toBe("2 Directors");
  });

  it("covers every canonical block exactly once", () => {
    expect(EXECUTION_BLOCKS.map((block) => block.id)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
    ]);
  });
});

describe("fillExecutionBlock", () => {
  it("replaces # tokens and leaves the signature line and Date blank", () => {
    const filled = fillExecutionBlock(selectExecutionBlock("company"), {
      companyName: "Acme Pty Ltd",
      authorisedSignatoryName: "Jane Smith",
    });
    const left = filled.rows[0]!.left
      .flatMap((line) => line.runs.map((run) => run.text))
      .join("");
    const right = filled.rows[0]!.right
      .flatMap((line) => line.runs.map((run) => run.text))
      .join("\n");

    expect(left).toContain("Acme Pty Ltd");
    expect(left).not.toContain("#COMPANY PTY LTD");
    expect(right).toContain("Jane Smith");
    expect(right).toContain("_______________________________");
    expect(right).toMatch(/^[\s\S]*\nDate$/);
    expect(right).not.toContain("#AuthorisedSignatoryName");
  });

  it("does not treat the Date label as the #Date authorising-document token", () => {
    const filled = fillExecutionBlock(
      selectExecutionBlock("partnership_authorised"),
      {
        partnershipName: "Smith & Co",
        documentName: "Partnership Authority",
        authorisingDate: "1 July 2026",
        authorisedSignatoryName: "Pat Smith",
      },
    );
    const left = filled.rows[0]!.left
      .flatMap((line) => line.runs.map((run) => run.text))
      .join("");
    const right = filled.rows[0]!.right
      .map((line) => line.runs.map((run) => run.text).join(""))
      .join("\n");

    expect(left).toContain("Partnership Authority dated 1 July 2026");
    expect(right.split("\n")).toContain("Date");
    expect(right).not.toContain("1 July 2026");
  });
});

describe("renderExecutionBlockMarkdown", () => {
  it("renders a borderless two-column table for a company default", () => {
    const markdown = renderExecutionBlockMarkdown(
      selectExecutionBlock("company"),
      { companyName: "Acme Pty Ltd" },
    );
    expect(markdown).toContain("[01 - Authorised Signatory]");
    expect(markdown).toContain("| --- | --- |");
    expect(markdown).toContain("Acme Pty Ltd");
    expect(markdown).toContain("clause 126");
  });
});

describe("AU execution-block prompt", () => {
  it("is generic Australian law content with no firm brand or house styles", () => {
    expect(AU_EXECUTION_BLOCKS_PROMPT).toContain("AUSTRALIAN EXECUTION BLOCKS:");
    expect(AU_EXECUTION_BLOCKS_PROMPT).toContain("do not hand-draft");
    expect(AU_EXECUTION_BLOCKS_PROMPT).toContain("executionBlocks");
    expect(AU_EXECUTION_BLOCKS_PROMPT).not.toContain("Attune");
    expect(AU_EXECUTION_BLOCKS_PROMPT).not.toContain("AL H");
    expect(AU_EXECUTION_BLOCKS_PROMPT).not.toContain("Particluars");
    for (const block of EXECUTION_BLOCKS) {
      expect(AU_EXECUTION_BLOCKS_PROMPT).toContain(
        `[${block.id} - ${block.label}]`,
      );
    }
  });

  it("appends only for Australian practitioners", () => {
    expect(isAustralianJurisdiction("Australia")).toBe(true);
    expect(isAustralianJurisdiction("australia")).toBe(true);
    expect(isAustralianJurisdiction("Singapore")).toBe(false);
    expect(withAuExecutionBlocksPrompt("extra", "Singapore")).toBe("extra");
    expect(withAuExecutionBlocksPrompt(undefined, "Australia")).toBe(
      AU_EXECUTION_BLOCKS_PROMPT,
    );
    expect(withAuExecutionBlocksPrompt("extra", "Australia")).toContain(
      "AUSTRALIAN EXECUTION BLOCKS:",
    );
  });
});
