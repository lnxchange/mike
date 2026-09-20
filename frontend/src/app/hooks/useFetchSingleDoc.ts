"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/app/lib/mikeApi";
import { authenticatedFetch } from "@/app/lib/authEvents";
import {
    DOCUMENT_FETCH_TIMEOUT_MS,
    DOCUMENT_LOAD_FAILED_MESSAGE,
    DOCUMENT_LOAD_TIMEOUT_MESSAGE,
} from "@/app/lib/documentViewerTimeout";

/**
 * /display returns PDF bytes (when the active version has a PDF rendition),
 * raw spreadsheet bytes (xlsx/xlsm/xls — never converted to PDF), or raw DOCX
 * bytes otherwise. Reporting the type lets the caller swap between PdfView
 * (PDF.js), SpreadsheetView (Fortune-sheet), and DocxView (docx-preview).
 */
export type DocResult =
    | { type: "pdf"; buffer: ArrayBuffer }
    | { type: "spreadsheet"; buffer: ArrayBuffer }
    | { type: "docx" }
    | null;

/** Office spreadsheet content types served raw by /display. */
function isSpreadsheetContentType(contentType: string): boolean {
    return (
        contentType.includes("spreadsheetml") || // .xlsx
        contentType.includes("ms-excel") // .xls / .xlsm
    );
}

function isPdfMagic(buffer: ArrayBuffer): boolean {
    const head = new Uint8Array(buffer.slice(0, 5));
    return (
        head.length >= 5 &&
        head[0] === 0x25 &&
        head[1] === 0x50 &&
        head[2] === 0x44 &&
        head[3] === 0x46 &&
        head[4] === 0x2d
    );
}

export function useFetchSingleDoc(
    documentId: string | null | undefined,
    versionId?: string | null,
    displayUrl?: string | null,
    refetchKey?: number | string,
) {
    const [result, setResult] = useState<DocResult>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!documentId) {
            setResult(null);
            setLoading(false);
            setError(null);
            return;
        }
        const controller = new AbortController();
        const timeoutId = window.setTimeout(
            () => controller.abort(),
            DOCUMENT_FETCH_TIMEOUT_MS,
        );

        setLoading(true);
        setError(null);
        setResult(null);

        let cancelled = false;

        (async () => {
            try {
                if (cancelled) return;
                const qs = versionId
                    ? `?version_id=${encodeURIComponent(versionId)}`
                    : "";
                const response = await authenticatedFetch(
                    displayUrl ??
                        `${API_BASE}/single-documents/${documentId}/display${qs}`,
                    { credentials: "include", signal: controller.signal },
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                if (cancelled) return;

                const contentType = response.headers.get("content-type") ?? "";
                if (contentType.includes("application/pdf")) {
                    const buffer = await response.arrayBuffer();
                    if (!cancelled) setResult({ type: "pdf", buffer });
                } else if (isSpreadsheetContentType(contentType)) {
                    const buffer = await response.arrayBuffer();
                    if (!cancelled) setResult({ type: "spreadsheet", buffer });
                } else {
                    const buffer = await response.arrayBuffer();
                    if (cancelled) return;
                    // Proxies sometimes drop Content-Type. A PDF still has
                    // to open in PdfView, not sit on a blank canvas.
                    if (isPdfMagic(buffer)) {
                        setResult({ type: "pdf", buffer });
                    } else {
                        setResult({ type: "docx" });
                    }
                }
            } catch {
                if (!cancelled) {
                    setError(
                        controller.signal.aborted
                            ? DOCUMENT_LOAD_TIMEOUT_MESSAGE
                            : DOCUMENT_LOAD_FAILED_MESSAGE,
                    );
                }
            } finally {
                window.clearTimeout(timeoutId);
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
            controller.abort();
        };
    }, [displayUrl, documentId, versionId, refetchKey]);

    return { result, loading, error };
}
