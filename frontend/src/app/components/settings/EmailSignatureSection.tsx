"use client";

import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { SettingsCard } from "@/app/components/settings/SettingsCard";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { SETTINGS_CONTROL_CLASS } from "@/app/components/settings/SettingsTextInput";
import {
    getOutlookSignature,
    refreshOutlookSignature,
    saveOutlookSignature,
} from "@/app/lib/mikeApi";
import { cn } from "@/app/lib/utils";
import { userFacingApiError } from "@/app/lib/userFacingError";

const SIGNATURE_HTML = {
    ALLOWED_TAGS: [
        "a",
        "b",
        "br",
        "div",
        "em",
        "i",
        "img",
        "li",
        "ol",
        "p",
        "span",
        "strong",
        "table",
        "tbody",
        "td",
        "th",
        "thead",
        "tr",
        "u",
        "ul",
    ],
    ALLOWED_ATTR: [
        "align",
        "alt",
        "border",
        "cellpadding",
        "cellspacing",
        "class",
        "colspan",
        "height",
        "href",
        "id",
        "rel",
        "rowspan",
        "src",
        "style",
        "target",
        "valign",
        "width",
    ],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP:
        /^(?:(?:https?|cid|mailto):|data:image\/(?:png|jpeg|gif|webp);base64,)/i,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
};

function signatureHtml(value: string): string {
    return DOMPurify.sanitize(value, SIGNATURE_HTML);
}

export function EmailSignatureSection() {
    const editorRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [busy, setBusy] = useState<"save" | "copy" | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [statusIsError, setStatusIsError] = useState(false);
    const [revision, setRevision] = useState(0);
    const htmlRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void getOutlookSignature()
            .then((result) => {
                if (cancelled) return;
                htmlRef.current = result.html;
                setLoadFailed(false);
                setRevision((value) => value + 1);
            })
            .catch((error) => {
                if (cancelled) return;
                setLoadFailed(true);
                setStatusIsError(true);
                setStatus(
                    userFacingApiError(
                        error,
                        "Your signature could not be loaded.",
                    ),
                );
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (loading || !editorRef.current) return;
        editorRef.current.innerHTML = signatureHtml(htmlRef.current ?? "");
    }, [loading, revision]);

    function show(message: string, isError: boolean) {
        setStatus(message);
        setStatusIsError(isError);
    }

    async function save() {
        const next = editorRef.current?.innerHTML ?? "";
        setBusy("save");
        show("", false);
        try {
            const result = await saveOutlookSignature(next);
            htmlRef.current = result.html;
            setRevision((value) => value + 1);
            setLoadFailed(false);
            show(result.html ? "Saved" : "Removed", false);
        } catch (error) {
            show(
                userFacingApiError(error, "Your signature could not be saved."),
                true,
            );
        } finally {
            setBusy(null);
        }
    }

    async function copyFromOutlook() {
        setBusy("copy");
        show("", false);
        try {
            const result = await refreshOutlookSignature();
            htmlRef.current = result.html;
            setRevision((value) => value + 1);
            setLoadFailed(false);
            show("Copied from Outlook", false);
        } catch (error) {
            show(
                userFacingApiError(
                    error,
                    "Your signature could not be copied from Outlook.",
                ),
                true,
            );
        } finally {
            setBusy(null);
        }
    }

    return (
        <section className="space-y-3">
            <SettingsHeading>Email signature</SettingsHeading>
            <SettingsCard>
                <SettingsRow layout="stacked">
                    <div className="space-y-3">
                        <SettingsDescription>
                            The first time you stage a draft, Colleague copies
                            your Outlook signature, including the logo, and
                            keeps it here. Later drafts use this copy. Edit it
                            whenever you want, then save. Clearing the field
                            and saving means the next draft copies it again.
                        </SettingsDescription>
                        {loading ? (
                            <p className="text-sm text-gray-500">Loading...</p>
                        ) : (
                            <div
                                ref={editorRef}
                                contentEditable={busy === null}
                                role="textbox"
                                aria-multiline="true"
                                aria-label="Email signature"
                                className={cn(
                                    SETTINGS_CONTROL_CLASS,
                                    "min-h-28 overflow-auto px-3 py-2 [&_img]:my-2 [&_img]:max-h-16 [&_img]:w-auto",
                                )}
                            />
                        )}
                        {status ? (
                            <p
                                className={
                                    statusIsError
                                        ? "text-xs text-red-600"
                                        : "text-xs text-gray-400"
                                }
                                aria-live="polite"
                            >
                                {status}
                            </p>
                        ) : null}
                        <div className="flex justify-end gap-4">
                            <button
                                type="button"
                                onClick={() => void copyFromOutlook()}
                                disabled={loading || busy !== null}
                                className="text-xs font-medium text-gray-700 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-400"
                            >
                                {busy === "copy"
                                    ? "Copying..."
                                    : "Copy from Outlook"}
                            </button>
                            <button
                                type="button"
                                onClick={() => void save()}
                                disabled={
                                    loading || loadFailed || busy !== null
                                }
                                className="text-xs font-medium text-gray-700 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-400"
                            >
                                {busy === "save" ? "Saving..." : "Save signature"}
                            </button>
                        </div>
                    </div>
                </SettingsRow>
            </SettingsCard>
        </section>
    );
}
