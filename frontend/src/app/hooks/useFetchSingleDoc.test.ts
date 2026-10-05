import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { authenticatedFetch } from "@/app/lib/authEvents";
import { useFetchSingleDoc } from "./useFetchSingleDoc";

vi.mock("@/app/lib/authEvents", () => ({ authenticatedFetch: vi.fn() }));
beforeEach(() => vi.mocked(authenticatedFetch).mockReset());
const pdfBytes = () => Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const pdf = () =>
    new Response(pdfBytes(), {
        headers: { "Content-Type": "application/pdf" },
    });
const pdfMagic = () => new Response(pdfBytes());

it("does not refetch stable inputs, refreshes revisions, and clears a closed document", async () => {
    vi.mocked(authenticatedFetch).mockImplementation(async () => pdf());
    const { result, rerender } = renderHook(
        ({ id, revision }) => useFetchSingleDoc(id, "v1", null, revision),
        { initialProps: { id: "d1" as string | null, revision: "r1" } },
    );
    await waitFor(() => expect(result.current.result?.type).toBe("pdf"));
    const loaded = result.current.result;
    rerender({ id: "d1", revision: "r1" });
    expect(result.current.result).toBe(loaded);
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
    rerender({ id: "d1", revision: "r2" });
    await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ id: null, revision: "r2" });
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
});

it("aborts superseded downloads and ignores late results", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(authenticatedFetch)
        .mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve;
            }),
        )
        .mockImplementation(async () => pdf());
    const { result, rerender, unmount } = renderHook(
        ({ version }) => useFetchSingleDoc("d1", version),
        { initialProps: { version: "v1" } },
    );
    const oldSignal = vi.mocked(authenticatedFetch).mock.calls[0][1]?.signal;
    rerender({ version: "v2" });
    expect(oldSignal?.aborted).toBe(true);
    await waitFor(() => expect(result.current.result?.type).toBe("pdf"));
    const latest = result.current.result;
    await act(async () =>
        finish(
            new Response("old spreadsheet", {
                headers: { "Content-Type": "application/vnd.ms-excel" },
            }),
        ),
    );
    expect(result.current.result).toBe(latest);
    const latestSignal = vi.mocked(authenticatedFetch).mock.calls[1][1]?.signal;
    unmount();
    expect(latestSignal?.aborted).toBe(true);
});

it("treats a PDF magic header as a PDF when Content-Type is missing", async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(pdfMagic());
    const { result } = renderHook(() => useFetchSingleDoc("d1"));
    await waitFor(() => expect(result.current.result?.type).toBe("pdf"));
    expect(result.current.error).toBeNull();
});

it("surfaces a load error for a 304 or HTML body without treating it as a timeout", async () => {
    vi.mocked(authenticatedFetch).mockResolvedValueOnce(
        new Response(null, { status: 304 }),
    );
    const { result, rerender } = renderHook(
        ({ id }) => useFetchSingleDoc(id),
        { initialProps: { id: "d1" } },
    );
    await waitFor(() =>
        expect(result.current.error).toBe(
            "This document could not be loaded. Please try again.",
        ),
    );
    expect(result.current.error).not.toBe(
        "This document is taking too long to open. Please try again.",
    );
    expect(authenticatedFetch).toHaveBeenCalledWith(
        "/api/single-documents/d1/display",
        expect.objectContaining({ cache: "no-store" }),
    );

    vi.mocked(authenticatedFetch).mockResolvedValueOnce(
        new Response("<html>error</html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
        }),
    );
    rerender({ id: "d2" });
    await waitFor(() =>
        expect(result.current.error).toBe(
            "This document could not be loaded. Please try again.",
        ),
    );
    expect(result.current.result).toBeNull();
});

it("rejects an application/pdf response that is not a PDF", async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(
        new Response("<!doctype html>", {
            headers: { "Content-Type": "application/pdf" },
        }),
    );
    const { result } = renderHook(() => useFetchSingleDoc("d1"));
    await waitFor(() =>
        expect(result.current.error).toBe(
            "This document could not be loaded. Please try again.",
        ),
    );
    expect(result.current.result).toBeNull();
});
