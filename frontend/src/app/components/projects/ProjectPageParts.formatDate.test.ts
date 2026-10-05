import { describe, expect, it } from "vitest";
import { formatDate } from "./ProjectPageParts";

describe("formatDate", () => {
    it("hides missing and Unix-epoch timestamps instead of showing 1970", () => {
        expect(formatDate(null)).toBe("");
        expect(formatDate(undefined)).toBe("");
        expect(formatDate("")).toBe("");
        expect(formatDate("1970-01-01T00:00:00.000Z")).toBe("");
        expect(formatDate(null as unknown as string)).not.toMatch(/1970/);
    });

    it("formats real dates", () => {
        expect(formatDate("2026-09-20T22:43:42.846Z")).toMatch(/2026/);
    });
});
