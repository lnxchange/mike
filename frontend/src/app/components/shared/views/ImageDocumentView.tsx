"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useFetchDocxBytes } from "@/app/hooks/useFetchDocxBytes";
import { viewRoundingClass, type ViewRounding } from "./viewRounding";

interface Props {
    documentId: string;
    versionId?: string | null;
    displayUrl?: string | null;
    refetchKey?: number | string;
    rounded?: ViewRounding;
    alt?: string;
}

/** Raster preview for a PNG or JPEG document. The bytes are the file itself. */
export function ImageDocumentView({
    documentId,
    versionId,
    displayUrl,
    refetchKey,
    rounded = false,
    alt = "Document image",
}: Props) {
    const { bytes, loading, error } = useFetchDocxBytes(
        documentId,
        versionId,
        refetchKey,
        displayUrl,
    );
    const [src, setSrc] = useState<string | null>(null);

    useEffect(() => {
        if (!bytes) {
            setSrc(null);
            return;
        }
        const url = URL.createObjectURL(new Blob([bytes]));
        setSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [bytes]);

    return (
        <div
            className={`flex h-full min-h-0 w-full items-center justify-center overflow-auto bg-gray-50 ${viewRoundingClass(rounded)}`}
        >
            {loading && !src ? (
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-label="Loading image" />
            ) : error || !src ? (
                <p className="px-6 text-center text-sm text-gray-500">
                    {error ?? "This image could not be displayed."}
                </p>
            ) : (
                <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
            )}
        </div>
    );
}
