import { describe, expect, it } from "vitest";
import { playbookRole } from "../playbooks.access";
import {
    normalizeFindings,
    reviewPrompt,
    type PlaybookContent,
} from "../playbooks.review";

const content: PlaybookContent = {
    rules: [
        {
            id: "rule-1",
            name: "Liability",
            concept: "A cap on liability",
            required: true,
            standard: "Liability is capped at fees paid.",
            fallbacks: ["Liability is capped at twelve months of fees."],
            unacceptable: ["Liability is unlimited."],
            guidance: "",
        },
    ],
};

describe("playbook reviews", () => {
    it("tells the model to apply unacceptable positions first and not invent text", () => {
        const prompt = reviewPrompt(content, "The contract.", "strict");
        expect(prompt).toContain("Apply unacceptable positions first");
        expect(prompt).toContain("Do not invent contract language");
        expect(prompt).toContain("REVIEW MODE: strict");
    });

    it("drops a quote that is not in the contract", () => {
        const findings = normalizeFindings("Liability is capped at the fees paid.", [
            {
                ruleId: "rule-1",
                ruleName: "Liability",
                status: "unacceptable",
                quote: "Liability is unlimited.",
                location: "clause 8",
                analysis: "Missing.",
                suggestedText: "Liability is capped at the fees paid.",
            },
        ]);
        expect(findings).toEqual([]);
    });

    it("keeps an exact quote and a missing required rule", () => {
        const contract = "Liability is unlimited.";
        const findings = normalizeFindings(contract, [
            {
                ruleId: "rule-1",
                ruleName: "Liability",
                status: "unacceptable",
                quote: "Liability is unlimited.",
                location: "clause 8",
                analysis: "Outside the position.",
                suggestedText: "Liability is capped at the fees paid.",
            },
            {
                ruleId: "rule-2",
                ruleName: "Insurance",
                status: "missing_required",
                quote: "invented clause",
                location: "",
                analysis: "The contract has no insurance clause.",
                suggestedText: "The Supplier shall maintain insurance.",
            },
        ]);
        expect(findings).toHaveLength(2);
        expect(findings[0]?.quote).toBe("Liability is unlimited.");
        expect(findings[1]?.quote).toBe("");
        expect(findings[1]?.suggestedText).toContain("insurance");
    });
});

describe("playbook access", () => {
    const playbook = {
        user_id: "owner",
        org_id: "org-1",
        visibility: "private" as const,
    };

    it("lets the creator edit and a public member only run", () => {
        expect(
            playbookRole({
                playbook,
                userId: "owner",
                orgIds: new Set(),
                shareRole: null,
            }),
        ).toBe("owner");
        expect(
            playbookRole({
                playbook: { ...playbook, visibility: "public" },
                userId: "member",
                orgIds: new Set(["org-1"]),
                shareRole: null,
            }),
        ).toBe("viewer");
    });

    it("hides a private playbook from other organisation members", () => {
        expect(
            playbookRole({
                playbook,
                userId: "member",
                orgIds: new Set(["org-1"]),
                shareRole: null,
            }),
        ).toBeNull();
    });

    it("lets a named editor change the rules", () => {
        expect(
            playbookRole({
                playbook,
                userId: "editor",
                orgIds: new Set(["org-1"]),
                shareRole: "editor",
            }),
        ).toBe("editor");
    });
});
