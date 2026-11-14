import { describe, expect, it, vi } from "vitest";
import type { AssistantEvent } from "@mike/contracts";
import { runPlanChain } from "../chat.planRun";
import { PLAN_SLICE_CAP } from "../engine/tools/planTools";

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
    items: pending.items.map((item) => ({ ...item, status: "completed" as const })),
};

describe("runPlanChain", () => {
    it("runs the next slice of a pending plan and does not insert a user message", async () => {
        let stored = [pending];
        const runSlice = vi.fn(async () => ({
            events: [
                finished,
                { type: "content" as const, text: "The note is drafted." },
            ],
            cancelled: false,
        }));
        const userInserts: string[] = [];

        const result = await runPlanChain({
            slicesCompleted: 1,
            previousStatusKey: null,
            loadEvents: async () => stored,
            runSlice,
            saveMerged: async (existing, slice) => {
                stored = [
                    ...existing.filter((event) => event.type !== "plan"),
                    ...slice.events,
                ];
            },
        });

        expect(userInserts).toEqual([]);
        expect(runSlice).toHaveBeenCalledOnce();
        expect(runSlice).toHaveBeenCalledWith("plan-1");
        expect(result.stop).toBe("complete");
        expect(result.slicesRun).toBe(1);
    });

    it("does not run a slice when the plan is finished, asking, cancelled, or in error", async () => {
        const runSlice = vi.fn();
        for (const events of [
            [finished],
            [pending, { type: "ask_inputs" as const, event_id: "ask", items: [] }],
            [pending, { type: "content" as const, text: "Cancelled by user." }],
            [
                pending,
                { type: "error" as const, message: "Sorry, something went wrong." },
            ],
        ]) {
            const result = await runPlanChain({
                slicesCompleted: 1,
                previousStatusKey: null,
                loadEvents: async () => events,
                runSlice,
                saveMerged: async () => {},
            });
            expect(result.slicesRun).toBe(0);
        }
        expect(runSlice).not.toHaveBeenCalled();
    });

    it("stops when a slice does not move the plan", async () => {
        const runSlice = vi.fn(async () => ({
            events: [pending, { type: "content" as const, text: "Still reading." }],
            cancelled: false,
        }));
        let stored = [pending];
        const result = await runPlanChain({
            slicesCompleted: 1,
            previousStatusKey: null,
            loadEvents: async () => stored,
            runSlice,
            saveMerged: async (_existing, slice) => {
                stored = slice.events;
            },
        });
        expect(runSlice).toHaveBeenCalledOnce();
        expect(result.stop).toBe("stall");
    });

    it("does not start a slice once the cap is reached", async () => {
        const runSlice = vi.fn();
        const result = await runPlanChain({
            slicesCompleted: PLAN_SLICE_CAP,
            previousStatusKey: null,
            loadEvents: async () => [pending],
            runSlice,
            saveMerged: async () => {},
        });
        expect(runSlice).not.toHaveBeenCalled();
        expect(result.stop).toBe("cap");
    });
});
