import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DOCUMENT_LOAD_TIMEOUT_MESSAGE,
    withTimeout,
} from "./documentViewerTimeout";

afterEach(() => {
    vi.useRealTimers();
});

describe("withTimeout", () => {
    it("resolves when the work finishes in time", async () => {
        await expect(withTimeout(Promise.resolve("ready"), 50)).resolves.toBe(
            "ready",
        );
    });

    it("rejects with a viewer message when the work never finishes", async () => {
        vi.useFakeTimers();
        const pending = withTimeout(new Promise(() => {}), 1_000);
        const expectation = expect(pending).rejects.toThrow(
            DOCUMENT_LOAD_TIMEOUT_MESSAGE,
        );
        await vi.advanceTimersByTimeAsync(1_000);
        await expectation;
    });
});
