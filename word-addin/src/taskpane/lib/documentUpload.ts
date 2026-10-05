import {
  SUPPORTED_UPLOAD_ACCEPT,
  isSupportedUploadFilename,
} from "@mike/upload-session-client";

export const SUPPORTED_DOCUMENT_ACCEPT = SUPPORTED_UPLOAD_ACCEPT;

export function partitionSupportedDocumentFiles(files: File[]): {
  supported: File[];
  unsupported: File[];
} {
  const supported: File[] = [];
  const unsupported: File[] = [];

  for (const file of files) {
    (isSupportedUploadFilename(file.name) ? supported : unsupported).push(file);
  }

  return { supported, unsupported };
}
