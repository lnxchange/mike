// PDF renditions and page counts for uploaded files. Shared by the per-file
// worker (uploads.processing.ts) and the expansion path that files email
// attachments and archive entries (uploads.expand.ts).

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { convertedPdfKey, officeFileToPdf } from "../../lib/convert";
import { shouldConvertToPdf } from "../../lib/documentTypes";
import { emailToHtml, type ParsedEmail } from "../../lib/emailMessage";
import { uploadFileFromPath } from "../../lib/storage";

export async function countPdfPages(filePath: string): Promise<number | null> {
  let loadingTask:
    | {
        promise: Promise<{ numPages: number }>;
        destroy?: () => Promise<void>;
      }
    | undefined;
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
    loadingTask = (
      pdfjsLib as unknown as {
        getDocument: (options: unknown) => {
          promise: Promise<{ numPages: number }>;
          destroy?: () => Promise<void>;
        };
      }
    ).getDocument({ url: pathToFileURL(filePath).href });
    const pdf = await loadingTask.promise;
    return pdf.numPages;
  } catch {
    return null;
  } finally {
    await loadingTask?.destroy?.().catch(() => {});
  }
}

export function renditionKey(
  userId: string,
  documentId: string,
  versionSlug?: string,
): string {
  return versionSlug
    ? `converted-pdfs/${userId}/${documentId}/${versionSlug}.pdf`
    : convertedPdfKey(userId, documentId);
}

/**
 * Convert an Office file to PDF and upload the rendition. Returns the storage
 * key, the source key when the file already is a PDF, or null when the type
 * has no PDF rendering or the conversion failed (the document still lands;
 * it just has no preview).
 */
export async function buildPdfRendition(args: {
  sourceFilePath: string;
  workingDirectory: string;
  fileType: string;
  userId: string;
  documentId: string;
  versionSlug?: string;
  sourceStoragePath: string;
}): Promise<string | null> {
  if (args.fileType === "pdf") return args.sourceStoragePath;
  if (!shouldConvertToPdf(args.fileType)) return null;
  try {
    const pdfPath = await officeFileToPdf(
      args.sourceFilePath,
      args.workingDirectory,
    );
    const key = renditionKey(args.userId, args.documentId, args.versionSlug);
    await uploadFileFromPath(key, pdfPath, "application/pdf");
    return key;
  } catch (error) {
    console.error("[upload-worker] document conversion failed", {
      documentId: args.documentId,
      fileType: args.fileType,
      error,
    });
    return null;
  }
}

/**
 * Render a parsed email to PDF through LibreOffice's HTML import and upload
 * it. Returns the local PDF path (for page counting) and the storage key, or
 * null when rendering failed. A message with no rendition is still filed;
 * the assistant reads it from the parsed text regardless.
 */
export async function buildEmailPdfRendition(args: {
  email: ParsedEmail;
  importedAttachments: string[];
  workingDirectory: string;
  userId: string;
  documentId: string;
}): Promise<{ localPath: string; key: string } | null> {
  try {
    const htmlPath = join(args.workingDirectory, "message.html");
    await writeFile(
      htmlPath,
      emailToHtml(args.email, {
        importedAttachments: args.importedAttachments,
      }),
      "utf8",
    );
    const pdfPath = await officeFileToPdf(htmlPath, args.workingDirectory);
    const key = renditionKey(args.userId, args.documentId);
    await uploadFileFromPath(key, pdfPath, "application/pdf");
    return { localPath: pdfPath, key };
  } catch (error) {
    console.error("[upload-worker] email rendering failed", {
      documentId: args.documentId,
      error,
    });
    return null;
  }
}
