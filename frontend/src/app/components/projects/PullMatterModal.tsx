"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { pullZohoMatter, searchZohoMatters } from "@/app/lib/mikeApi";
import {
    rememberJustPulledMatter,
    type ZohoMatterSearchHit,
} from "@/app/lib/matterSync";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { userFacingApiError } from "@/app/lib/userFacingError";
import { Modal } from "../modals/Modal";
import { FieldLabel, FormTextInput } from "../ui/form-field";
import { EmptyState } from "../ui/empty-state";
import {
    LIQUID_GLASS_MODAL_ROW_HOVER_CLASS,
    LIQUID_GLASS_MODAL_ROW_SELECTED_CLASS,
} from "../ui/liquid-surface";
import { cn } from "@/app/lib/utils";
import { appConfig } from "@/config";

const t = appConfig.terminology;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;
const NO_FOLDER_REASON = "No SharePoint folder yet";

interface Props {
    open: boolean;
    onClose: () => void;
}

/**
 * Search Zoho for a matter and have the filer create it here and keep it in
 * step with its SharePoint folder. On success the page moves to the new
 * matter, whose header shows the sync progress.
 */
export function PullMatterModal({ open, onClose }: Props) {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
    // Results and failures are keyed by the query that produced them, so a
    // stale answer is simply ignored and nothing has to be reset in an effect.
    const [search, setSearch] = useState<{
        query: string;
        matters: ZohoMatterSearchHit[];
    } | null>(null);
    const [searchError, setSearchError] = useState<{
        query: string;
        message: string;
    } | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [pulling, setPulling] = useState(false);
    const [pullError, setPullError] = useState("");

    const trimmedQuery = debouncedQuery.trim();
    const canSearch = trimmedQuery.length >= MIN_SEARCH_LENGTH;

    useEffect(() => {
        if (!open || !canSearch) return;
        let cancelled = false;
        searchZohoMatters(trimmedQuery)
            .then((matters) => {
                if (!cancelled) setSearch({ query: trimmedQuery, matters });
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setSearchError({
                    query: trimmedQuery,
                    message: userFacingApiError(
                        err,
                        "The search could not be run.",
                    ),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [open, canSearch, trimmedQuery]);

    if (!open) return null;

    const results =
        canSearch && search?.query === trimmedQuery ? search.matters : null;
    const currentSearchError =
        canSearch && searchError?.query === trimmedQuery
            ? searchError.message
            : "";
    const searching = canSearch && results === null && !currentSearchError;
    const selected = results?.find((m) => m.id === selectedId) ?? null;
    const error = pullError || currentSearchError;

    function reset() {
        setQuery("");
        setSearch(null);
        setSearchError(null);
        setSelectedId(null);
        setPulling(false);
        setPullError("");
    }

    function handleClose() {
        if (pulling) return;
        reset();
        onClose();
    }

    async function handlePull() {
        if (!selected || !selected.hasFolder || pulling) return;
        setPulling(true);
        setPullError("");
        try {
            const result = await pullZohoMatter({ matterId: selected.id });
            rememberJustPulledMatter(result.projectId);
            router.push(`/projects/${result.projectId}`);
            reset();
            onClose();
        } catch (err: unknown) {
            setPullError(
                userFacingApiError(
                    err,
                    `The ${t.projectLower} could not be pulled from Zoho.`,
                ),
            );
            setPulling(false);
        }
    }

    const pullStatus = `Creating the ${t.projectLower} and pulling the first documents`;
    const footerStatus = pulling ? (
        <span className="flex items-center gap-2 text-sm text-gray-500" aria-hidden="true">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
            {pullStatus}
        </span>
    ) : searching ? (
        "Searching Zoho..."
    ) : undefined;

    return (
        <Modal
            open={open}
            onClose={handleClose}
            breadcrumbs={[t.projects, "Pull from Zoho"]}
            footerStatus={footerStatus}
            cancelAction={{
                label: "Cancel",
                onClick: handleClose,
                disabled: pulling,
            }}
            primaryAction={{
                label: pulling ? "Pulling" : "Pull and keep in sync",
                icon: pulling ? (
                    <Loader2
                        aria-hidden="true"
                        className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                    />
                ) : undefined,
                type: "button",
                onClick: () => void handlePull(),
                disabled: !selected || !selected.hasFolder || pulling,
            }}
        >
            <div className="flex min-h-0 flex-1 flex-col">
                <div>
                    <FieldLabel htmlFor="pull-matter-search">
                        Find a {t.projectLower} in Zoho
                    </FieldLabel>
                    <div className="relative">
                        <Search
                            aria-hidden="true"
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                        />
                        <FormTextInput
                            id="pull-matter-search"
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={`${t.referenceNumber}, name or client`}
                            className="pl-9"
                            autoFocus
                            disabled={pulling}
                            aria-describedby="pull-matter-search-hint"
                        />
                    </div>
                    <p
                        id="pull-matter-search-hint"
                        className="mt-2 text-xs text-gray-400"
                    >
                        Type at least {MIN_SEARCH_LENGTH} characters. The{" "}
                        {t.projectLower} is created here and its SharePoint
                        folder is kept in sync.
                    </p>
                </div>

                <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
                    {pulling ? (
                        <PullInProgress
                            status={pullStatus}
                            projectLabel={t.project}
                        />
                    ) : results === null ? null : results.length === 0 ? (
                        <EmptyState
                            className="pt-6"
                            title={`No ${t.projectsLower} found`}
                            description={`Nothing in Zoho matched "${trimmedQuery}". Try the ${t.referenceNumber.toLowerCase()} or part of the name.`}
                        />
                    ) : (
                        <ul
                            role="listbox"
                            aria-label={`Zoho ${t.projectsLower}`}
                            className="space-y-1"
                        >
                            {results.map((matter) => {
                                const isSelected = matter.id === selectedId;
                                const disabled = !matter.hasFolder;
                                return (
                                    <li key={matter.id}>
                                        <button
                                            type="button"
                                            role="option"
                                            aria-selected={isSelected}
                                            aria-disabled={disabled || undefined}
                                            disabled={disabled || pulling}
                                            onClick={() =>
                                                setSelectedId(matter.id)
                                            }
                                            className={cn(
                                                "flex w-full items-baseline gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                                                disabled
                                                    ? "cursor-not-allowed text-gray-400"
                                                    : LIQUID_GLASS_MODAL_ROW_HOVER_CLASS,
                                                isSelected &&
                                                    LIQUID_GLASS_MODAL_ROW_SELECTED_CLASS,
                                            )}
                                        >
                                            <span className="w-24 shrink-0 text-xs tabular-nums text-gray-500">
                                                {matter.matterNumber ?? "—"}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span
                                                    className={cn(
                                                        "block truncate text-sm",
                                                        disabled
                                                            ? "text-gray-400"
                                                            : "text-gray-800",
                                                    )}
                                                >
                                                    {matter.name}
                                                </span>
                                                <span className="block truncate text-xs text-gray-400">
                                                    {[
                                                        matter.account,
                                                        matter.status,
                                                        disabled
                                                            ? NO_FOLDER_REASON
                                                            : null,
                                                    ]
                                                        .filter(Boolean)
                                                        .join(" · ")}
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
            </div>
        </Modal>
    );
}

function PullInProgress({
    status,
    projectLabel,
}: {
    status: string;
    projectLabel: string;
}) {
    const steps = [
        `Creating the ${projectLabel.toLowerCase()}`,
        "Pulling documents from SharePoint",
    ];
    return (
        <div role="status" aria-live="polite" className="px-1 pt-2">
            <p className="text-sm text-gray-800">{status}</p>
            <div
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-200"
                role="progressbar"
                aria-label={status}
            >
                <div className="h-full w-1/3 rounded-full bg-gray-700 animate-indeterminate" />
            </div>
            <ul className="mt-4 space-y-2">
                {steps.map((step) => (
                    <li
                        key={step}
                        className="flex items-center gap-2 text-sm text-gray-600"
                    >
                        <Loader2
                            aria-hidden="true"
                            className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-500 motion-reduce:animate-none"
                        />
                        {step}
                    </li>
                ))}
            </ul>
        </div>
    );
}
