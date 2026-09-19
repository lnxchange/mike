import {
    SUPPORTED_UPLOAD_ACCEPT,
    UNSUPPORTED_UPLOAD_MESSAGE,
    isSupportedUploadFilename,
} from "@/shared/api/uploadSessionClient";

export const SUPPORTED_DOCUMENT_ACCEPT = SUPPORTED_UPLOAD_ACCEPT;
export const UNSUPPORTED_DOCUMENT_WARNING_MESSAGE = UNSUPPORTED_UPLOAD_MESSAGE;

export function isSupportedDocumentFile(file: File): boolean {
    return isSupportedUploadFilename(file.name);
}

export function partitionSupportedDocumentFiles(files: File[]) {
    const supported: File[] = [];
    const unsupported: File[] = [];

    for (const file of files) {
        if (isSupportedDocumentFile(file)) supported.push(file);
        else unsupported.push(file);
    }

    return { supported, unsupported };
}

export function formatUnsupportedDocumentWarning(files: File[]): string | null {
    if (files.length === 0) return null;
    return UNSUPPORTED_DOCUMENT_WARNING_MESSAGE;
}
