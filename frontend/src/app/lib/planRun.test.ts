import { describe, expect, it } from "vitest";
import type { AssistantEvent, Message } from "@/app/components/shared/types";
import {
    planSettleReason,
    shouldFollowServerPlan,
    shouldResumeIdlePlan,
} from "./planRun";

const pending: AssistantEvent = {
    type: "plan",
    event_id: "plan-1",
    title: "Review",
    items: [
        { id: "read", content: "Read the emails", status: "completed" },
        { id: "note", content: "Draft the note", status: "pending" },
    ],
};

const finished: AssistantEvent = {
    ...pending,
    items: pending.items.map((item) => ({ ...item, status: "completed" })),
};

describe("shouldFollowServerPlan", () => {
    it("follows an unfinished plan and stops for a question, a cancel, or a hard error", () => {
        expect(shouldFollowServerPlan([pending])).toBe(true);
        expect(shouldFollowServerPlan([finished])).toBe(false);
        expect(
            shouldFollowServerPlan([
                pending,
                { type: "ask_inputs", event_id: "ask", items: [] },
            ]),
        ).toBe(false);
        expect(
            shouldFollowServerPlan([
                pending,
                { type: "content", text: "Cancelled by user." },
            ]),
        ).toBe(false);
        expect(
            shouldFollowServerPlan([
                pending,
                { type: "error", message: "Sorry, something went wrong." },
            ]),
        ).toBe(false);
    });
});

describe("shouldResumeIdlePlan", () => {
    it("resumes a reopened chat whose latest plan is unfinished", () => {
        const messages: Message[] = [
            { role: "user", content: "Prepare the note." },
            { role: "assistant", content: "", events: [pending] },
        ];
        expect(shouldResumeIdlePlan(messages)).toBe(true);
        expect(
            shouldResumeIdlePlan([
                {
                    role: "assistant",
                    content: "",
                    events: [
                        pending,
                        { type: "content", text: "Cancelled by user." },
                    ],
                },
            ]),
        ).toBe(false);
    });
});

describe("planSettleReason", () => {
    it("names the three ways a plan run can settle", () => {
        expect(planSettleReason([finished])).toBe("finished");
        expect(
            planSettleReason([
                pending,
                { type: "ask_inputs", event_id: "ask", items: [] },
            ]),
        ).toBe("needs_input");
        expect(planSettleReason([pending])).toBe("stopped");
        expect(
            planSettleReason([
                pending,
                { type: "content", text: "Cancelled by user." },
            ]),
        ).toBeNull();
    });
});
