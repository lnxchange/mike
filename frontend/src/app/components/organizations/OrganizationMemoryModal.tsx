"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain } from "lucide-react";
import {
    MemoryConflictNotice,
    MemorySaveStatus,
    memoryActivityLabel,
} from "@/app/components/memory/MemoryEditorState";
import { MemoryUpdateFailedPopup } from "@/app/components/memory/MemoryUpdateFailedPopup";
import { useMemoryFileController } from "@/app/components/memory/useMemoryFileController";
import { Modal } from "@/app/components/modals/Modal";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FieldLabel } from "@/app/components/ui/form-field";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { MarkdownEditor } from "@/app/components/ui/markdown-editor";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { ToggleSwitchUI } from "@/shared/ui/ToggleSwitchUI";
import {
    getOrgMemory,
    setOrgMemoryEnabled,
    updateOrgMemory,
} from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";

export function OrganizationMemoryModal({
    open,
    onClose,
    orgId,
    orgName,
    canEdit,
}: {
    open: boolean;
    onClose: () => void;
    orgId: string;
    orgName: string | null;
    /** Caller is an organization admin. */
    canEdit: boolean;
}) {
    const [settingsMutation, setSettingsMutation] = useState<
        "enable" | "disable" | null
    >(null);
    const [disableMemoryConfirmOpen, setDisableMemoryConfirmOpen] =
        useState(false);
    const [closing, setClosing] = useState(false);
    const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
    const [savedNotice, setSavedNotice] = useState<string | null>(null);
    const loadMemory = useCallback(
        (signal?: AbortSignal) => getOrgMemory(orgId, signal),
        [orgId],
    );
    const saveMemory = useCallback(
        (content: string, revision: number) =>
            updateOrgMemory(orgId, content, revision),
        [orgId],
    );
    const {
        memory,
        draft,
        loading,
        loadError,
        conflict,
        error,
        autosaveError,
        dirty,
        autosave,
        load,
        syncCurrent,
        changeDraft,
        setError,
        setAutosaveError,
        useLatestConflict,
        keepDraftAfterConflict,
    } = useMemoryFileController({
        active: open,
        canEdit,
        mutationBlocked:
            settingsMutation !== null ||
            disableMemoryConfirmOpen ||
            discardConfirmOpen,
        pollBlocked: closing,
        flushOnUnmount: open && canEdit && settingsMutation === null,
        loadMemory,
        saveMemory,
        conflictLoadError:
            "Organization memory changed while you were editing. Reopen memory before saving again.",
        saveError:
            "Organization memory could not be saved. Your draft has been kept.",
    });

    useEffect(() => {
        if (!open) {
            setSavedNotice(null);
            setClosing(false);
            setSettingsMutation(null);
            setDisableMemoryConfirmOpen(false);
            setDiscardConfirmOpen(false);
        }
    }, [open]);

    async function persistMemoryEnabled(enabled: boolean) {
        if (!canEdit || settingsMutation || closing || autosave.inFlight)
            return;
        setSettingsMutation(enabled ? "enable" : "disable");
        setError(null);
        setAutosaveError(null);
        try {
            const current = await setOrgMemoryEnabled(orgId, enabled);
            syncCurrent(current);
            setDisableMemoryConfirmOpen(false);
            setSavedNotice(enabled ? "Organization memory enabled" : null);
        } catch (cause) {
            setError(
                userFacingApiError(
                    cause,
                    enabled
                        ? "Organization memory could not be enabled. Please try again."
                        : "Organization memory could not be disabled. Please try again.",
                ),
            );
            setDisableMemoryConfirmOpen(false);
        } finally {
            setSettingsMutation(null);
        }
    }

    async function requestClose() {
        if (disableMemoryConfirmOpen) {
            if (!settingsMutation) setDisableMemoryConfirmOpen(false);
            return;
        }
        if (discardConfirmOpen) {
            setDiscardConfirmOpen(false);
            return;
        }
        if (closing || settingsMutation) return;
        const canSaveCurrent = canEdit && !!memory?.enabled && !loadError;
        if (!dirty || !canSaveCurrent) {
            onClose();
            return;
        }

        if (autosaveError || conflict) {
            autosave.cancelPending();
            setDiscardConfirmOpen(true);
            return;
        }

        setClosing(true);
        const saved = await autosave.flush();
        if (saved) onClose();
        else {
            setClosing(false);
            autosave.cancelPending();
            setDiscardConfirmOpen(true);
        }
    }

    return (
        <Modal
            open={open}
            onClose={requestClose}
            breadcrumbs={[
                "Organizations",
                orgName ?? "Organization",
                "Organization Memory",
            ]}
            headerAction={
                memory?.enabled && memoryActivityLabel(memory) ? (
                    <p className="text-xs text-gray-400" role="status">
                        {memoryActivityLabel(memory)}
                    </p>
                ) : undefined
            }
            footerStatus={
                error ? (
                    <span className="text-sm text-red-600" role="alert">
                        {error}
                    </span>
                ) : autosaveError || autosave.status !== "idle" ? (
                    <MemorySaveStatus
                        error={autosaveError}
                        status={autosave.status}
                        onRetry={() => {
                            setAutosaveError(null);
                            autosave.retry();
                        }}
                    />
                ) : savedNotice ? (
                    <span className="text-sm text-gray-400" role="status">
                        {savedNotice}
                    </span>
                ) : null
            }
            primaryAction={{
                label: "Done",
                type: "button",
                onClick: () => void requestClose(),
                disabled: closing || settingsMutation !== null,
                "aria-busy": closing,
            }}
        >
            <div className="flex min-h-0 flex-1 flex-col gap-3 pb-3 pt-1">
                {loading ? (
                    <OrganizationMemorySkeleton />
                ) : loadError || !memory ? (
                    <GlassCardUI>
                        <EmptyState
                            icon={<Brain />}
                            title="Organization memory could not be loaded"
                            description="Try again to inspect this organization's shared memory."
                            tone="error"
                            className="px-5 py-8"
                            action={
                                <PillButtonUI
                                    tone="black"
                                    size="sm"
                                    onClick={() => void load()}
                                >
                                    Retry
                                </PillButtonUI>
                            }
                        />
                    </GlassCardUI>
                ) : (
                    <>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <FieldLabel as="p">Organization memory</FieldLabel>
                                <p className="text-sm text-gray-500">
                                    Shared house context for chats in this
                                    organization's matters. Admins edit it;
                                    chats do not update it.
                                </p>
                            </div>
                            <ToggleSwitchUI
                                checked={memory.enabled}
                                onCheckedChange={(enabled) => {
                                    setSavedNotice(null);
                                    if (enabled)
                                        void persistMemoryEnabled(true);
                                    else {
                                        autosave.cancelPending();
                                        setDisableMemoryConfirmOpen(true);
                                    }
                                }}
                                disabled={
                                    !canEdit ||
                                    closing ||
                                    autosave.inFlight ||
                                    settingsMutation !== null ||
                                    disableMemoryConfirmOpen ||
                                    discardConfirmOpen
                                }
                                aria-label="Enable organization memory"
                                aria-busy={settingsMutation !== null}
                            />
                        </div>

                        {!memory.enabled ? (
                            <GlassCardUI>
                                <EmptyState
                                    icon={<Brain />}
                                    title="Organization memory is off"
                                    description={
                                        canEdit
                                            ? "Turn it on to start a new shared organization memory.md for future conversations."
                                            : "An organization admin can enable memory for future organization conversations."
                                    }
                                    className="px-5 py-8"
                                />
                            </GlassCardUI>
                        ) : (
                            <>
                                {conflict ? (
                                    <MemoryConflictNotice
                                        project
                                        onReload={useLatestConflict}
                                        onKeepDraft={keepDraftAfterConflict}
                                    />
                                ) : null}

                                <div className="min-h-0 flex-1">
                                    <MarkdownEditor
                                        value={draft}
                                        onChange={
                                            canEdit
                                                ? (value) => {
                                                      changeDraft(value);
                                                      setSavedNotice(null);
                                                  }
                                                : undefined
                                        }
                                        readOnly={!canEdit}
                                        suspended={
                                            settingsMutation !== null ||
                                            closing ||
                                            disableMemoryConfirmOpen ||
                                            discardConfirmOpen
                                        }
                                        ariaLabel="Organization memory"
                                        className="h-full"
                                        allowTables={false}
                                    />
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>

            <ConfirmPopup
                open={disableMemoryConfirmOpen}
                title="Turn off organization memory?"
                message={`This will delete the existing organization memory.md file${dirty ? " and your unsaved draft" : ""}, and stop future organization memory until you turn it on again.`}
                confirmLabel="Disable"
                confirmVariant="danger"
                confirmStatus={
                    settingsMutation === "disable" ? "loading" : "idle"
                }
                onCancel={() => {
                    if (!settingsMutation) setDisableMemoryConfirmOpen(false);
                }}
                onConfirm={() => void persistMemoryEnabled(false)}
            />

            <ConfirmPopup
                open={discardConfirmOpen}
                title="Close without saving?"
                message="The latest changes could not be saved to this organization's memory.md. Closing now discards them."
                confirmLabel="Close without saving"
                confirmVariant="danger"
                onConfirm={() => {
                    autosave.cancelPending();
                    setDiscardConfirmOpen(false);
                    onClose();
                }}
                onCancel={() => setDiscardConfirmOpen(false)}
            />
            <MemoryUpdateFailedPopup
                memory={memory}
                scopeKey={`org:${orgId}`}
            />
        </Modal>
    );
}

function OrganizationMemorySkeleton() {
    return (
        <div className="space-y-4" aria-label="Loading organization memory">
            <div className="space-y-2">
                <div className="h-3 w-full max-w-xl animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-40 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="h-80 animate-pulse rounded-2xl bg-app-surface" />
        </div>
    );
}
