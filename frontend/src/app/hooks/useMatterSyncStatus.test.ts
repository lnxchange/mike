import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { getMatterSyncStatus } from "@/app/lib/mikeApi";
import {
    MATTER_DELTA_CHECK_MS,
    MATTER_SYNC_ACTIVE_POLL_MS,
    MATTER_SYNC_POLL_MS,
    useMatterDeltaCheck,
    useMatterSyncStatus,
} from "./useMatterSyncStatus";

vi.mock("@/app/lib/mikeApi", () => ({
    getMatterSyncStatus: vi.fn(),
}));

const syncing = (documentCount: number, remaining: number) => ({
    found: true as const,
    status: "Syncing" as const,
    matterNumber: "263334",
    matterName: "Intellihub - VAPs",
    documentCount,
    remaining,
    lastSyncAt: null,
    lastChangeAt: null,
    lastError: null,
});

describe("useMatterSyncStatus", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("does nothing while disabled", async () => {
        const { result } = renderHook(() =>
            useMatterSyncStatus({ projectId: "p1", enabled: false }),
        );
        await act(async () => {});
        expect(getMatterSyncStatus).not.toHaveBeenCalled();
        expect(result.current.status).toBeNull();
    });

    it("fetches once and stops when the matter is up to date", async () => {
        vi.mocked(getMatterSyncStatus).mockResolvedValue({
            ...syncing(10, 0),
            status: "Idle",
        });
        const { result } = renderHook(() =>
            useMatterSyncStatus({ projectId: "p1", enabled: true }),
        );
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.status).toMatchObject({ status: "Idle" });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_SYNC_POLL_MS * 2);
        });
        expect(getMatterSyncStatus).toHaveBeenCalledTimes(1);
    });

    it("polls while syncing and reports a growing document count", async () => {
        vi.mocked(getMatterSyncStatus)
            .mockResolvedValueOnce(syncing(10, 90))
            .mockResolvedValueOnce(syncing(34, 66))
            .mockResolvedValueOnce({ ...syncing(100, 0), status: "Idle" });
        const onIncrease = vi.fn();
        const { result } = renderHook(() =>
            useMatterSyncStatus({
                projectId: "p1",
                enabled: true,
                onDocumentCountIncreased: onIncrease,
            }),
        );
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(onIncrease).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_SYNC_ACTIVE_POLL_MS);
        });
        await waitFor(() =>
            expect(result.current.status).toMatchObject({ documentCount: 34 }),
        );
        expect(onIncrease).toHaveBeenCalledTimes(2);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_SYNC_ACTIVE_POLL_MS);
        });
        await waitFor(() =>
            expect(result.current.status).toMatchObject({ status: "Idle" }),
        );
        expect(onIncrease).toHaveBeenCalledTimes(3);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_SYNC_POLL_MS * 2);
        });
        expect(getMatterSyncStatus).toHaveBeenCalledTimes(3);
    });

    it("keeps polling Idle when the filer counts files the page has not rendered", async () => {
        vi.mocked(getMatterSyncStatus).mockResolvedValue({
            ...syncing(3, 0),
            status: "Idle",
        });
        const onIncrease = vi.fn();
        const { result, rerender } = renderHook(
            (props: { visible: number }) =>
                useMatterSyncStatus({
                    projectId: "p1",
                    enabled: true,
                    visibleDocumentCount: props.visible,
                    onDocumentCountIncreased: onIncrease,
                }),
            { initialProps: { visible: 0 } },
        );
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(onIncrease).toHaveBeenCalled();
        expect(getMatterSyncStatus).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_SYNC_ACTIVE_POLL_MS);
        });
        expect(getMatterSyncStatus).toHaveBeenCalledTimes(2);

        rerender({ visible: 3 });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_SYNC_ACTIVE_POLL_MS);
        });
        expect(getMatterSyncStatus).toHaveBeenCalledTimes(3);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_SYNC_POLL_MS * 2);
        });
        expect(getMatterSyncStatus).toHaveBeenCalledTimes(3);
    });

    it("keeps polling Idle while Railway still has open files", async () => {
        vi.mocked(getMatterSyncStatus)
            .mockResolvedValueOnce({
                ...syncing(0, 0),
                status: "Idle",
                files: [
                    {
                        id: "file-1",
                        filename: "Terms.pdf",
                        folderId: null,
                        stage: "processing",
                    },
                ],
            })
            .mockResolvedValueOnce({
                ...syncing(1, 0),
                status: "Idle",
                files: [],
            });
        const onIncrease = vi.fn();
        const { result } = renderHook(() =>
            useMatterSyncStatus({
                projectId: "p1",
                enabled: true,
                visibleDocumentCount: 1,
                onDocumentCountIncreased: onIncrease,
            }),
        );
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(onIncrease).toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_SYNC_ACTIVE_POLL_MS);
        });
        await waitFor(() =>
            expect(result.current.status).toMatchObject({ documentCount: 1 }),
        );

        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_SYNC_POLL_MS * 2);
        });
        expect(getMatterSyncStatus).toHaveBeenCalledTimes(2);
    });

    it("checks an open idle matter once a minute and stops when the page is gone", async () => {
        const onCheck = vi.fn();
        const { rerender, unmount } = renderHook(
            (props: { enabled: boolean }) =>
                useMatterDeltaCheck({ enabled: props.enabled, onCheck }),
            { initialProps: { enabled: true } },
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_DELTA_CHECK_MS);
        });
        expect(onCheck).toHaveBeenCalledTimes(1);

        rerender({ enabled: false });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_DELTA_CHECK_MS * 2);
        });
        expect(onCheck).toHaveBeenCalledTimes(1);

        unmount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_DELTA_CHECK_MS);
        });
        expect(onCheck).toHaveBeenCalledTimes(1);
    });

    it("treats a failed read as unknown and stops polling", async () => {
        vi.mocked(getMatterSyncStatus).mockRejectedValue(new Error("503"));
        const { result } = renderHook(() =>
            useMatterSyncStatus({ projectId: "p1", enabled: true }),
        );
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.status).toBeNull();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(MATTER_SYNC_POLL_MS * 2);
        });
        expect(getMatterSyncStatus).toHaveBeenCalledTimes(1);
    });
});
