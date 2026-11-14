"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/app/lib/mikeApi";
import { authenticatedFetch } from "@/app/lib/authEvents";
import {
    DOCUMENT_FETCH_TIMEOUT_MS,
    DOCUMENT_LOAD_FAILED_MESSAGE,
    DOCUMENT_LOAD_TIMEOUT_MESSAGE,
} from "@/app/lib/documentViewerTimeout";
import { reportNetworkFailure } from "@/app/lib/errorReporting";
import { isNetworkError, reportFlowFailure } from "@/app/lib/userFacingError";

/**
 * PdfView's loader. /display returns PDF bytes (a stored or on-demand PDF
 * rendition) for the files PdfView shows. Anything else is reported as
 * "docx" so a caller can route it to DocxView. Spreadsheets and .docx files
 * read their raw bytes from /file instead (see useFetchDocxBytes).
 */
export type DocResult =
    | { type: "pdf"; buffer: ArrayBuffer }
    | { type: "docx" }
    | null;

/**
 * This loader fetches bytes itself, so the API client's reporting does not
 * see its failures. A response that never came is the transport's one
 * "unreachable" event; a 5xx is a document-open fault with its request id;
 * a 4xx (gone, forbidden) is an answer, not a fault.
 */
function reportDocumentLoadFailure(error: unknown, url: string): void {
    if (isNetworkError(error)) {
        reportNetworkFailure(error, { method: "GET", url });
        return;
    }
    const status =
        error && typeof error === "object" && "status" in error
            ? (error as { status?: unknown }).status
            : undefined;
    const requestId =
        error && typeof error === "object" && "requestId" in error
            ? (error as { requestId?: unknown }).requestId
            : undefined;
    reportFlowFailure({
        operation: "documents.open",
        method: "GET",
        path: url,
        status: typeof status === "number" ? status : null,
        requestId: typeof requestId === "string" ? requestId : null,
        error,
    });
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

function isNonDocumentContentType(contentType: string): boolean {
    return (
        contentType.includes("json") ||
        contentType.includes("html") ||
        contentType.startsWith("text/")
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
        let timedOut = false;
        const timeoutId = window.setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, DOCUMENT_FETCH_TIMEOUT_MS);

        setLoading(true);
        setError(null);
        setResult(null);

        let cancelled = false;
        const qs = versionId
            ? `?version_id=${encodeURIComponent(versionId)}`
            : "";
        const url =
            displayUrl ??
            `${API_BASE}/single-documents/${documentId}/display${qs}`;

        (async () => {
            try {
                if (cancelled) return;
                const response = await authenticatedFetch(url, {
                    credentials: "include",
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw Object.assign(new Error(`HTTP ${response.status}`), {
                        status: response.status,
                        requestId: response.headers.get("x-request-id"),
                    });
                }
                if (cancelled) return;

                const contentType = response.headers.get("content-type") ?? "";
                const buffer = await response.arrayBuffer();
                if (cancelled) return;
                if (
                    contentType.includes("application/pdf") ||
                    isPdfMagic(buffer)
                ) {
                    if (!isPdfMagic(buffer)) {
                        throw new Error("HTTP 200 returned a non-PDF body");
                    }
                    setResult({ type: "pdf", buffer });
                } else if (isNonDocumentContentType(contentType)) {
                    throw new Error("HTTP 200 returned a non-document body");
                } else {
                    // Bytes for DOC/DOCX and spreadsheets come from /file.
                    setResult({ type: "docx" });
                }
            } catch (error) {
                if (cancelled) return;
                if (controller.signal.aborted && !timedOut) return;
                if (timedOut) {
                    setError(DOCUMENT_LOAD_TIMEOUT_MESSAGE);
                    return;
                }
                // The message stays generic; the event carries the identity
                // (a 5xx with its request id, or the transport failure).
                reportDocumentLoadFailure(error, url);
                setError(DOCUMENT_LOAD_FAILED_MESSAGE);
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
