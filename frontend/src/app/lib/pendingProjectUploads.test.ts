import { describe, expect, it } from "vitest";
import {
    hasPendingProjectUploads,
    stashPendingProjectUploads,
    takePendingProjectUploads,
} from "./pendingProjectUploads";

const file = (name: string) => new File(["x"], name);

describe("pendingProjectUploads", () => {
    it("hands files to exactly one taker", () => {
        const a = file("a.pdf");
        const b = file("b.docx");
        stashPendingProjectUploads("p1", [a]);
        stashPendingProjectUploads("p1", [b]);
        expect(hasPendingProjectUploads("p1")).toBe(true);
        expect(takePendingProjectUploads("p1")).toEqual([a, b]);
        expect(hasPendingProjectUploads("p1")).toBe(false);
        expect(takePendingProjectUploads("p1")).toEqual([]);
    });

    it("keeps projects separate and ignores empty stashes", () => {
        stashPendingProjectUploads("p2", []);
        expect(hasPendingProjectUploads("p2")).toBe(false);
        stashPendingProjectUploads("p3", [file("c.pdf")]);
        expect(takePendingProjectUploads("p2")).toEqual([]);
        expect(takePendingProjectUploads("p3")).toHaveLength(1);
    });
});
