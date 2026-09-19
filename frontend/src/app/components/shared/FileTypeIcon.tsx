import Image from "next/image";
import { File, FolderArchive, Mail } from "lucide-react";

export type FileTypeKind =
    | "pdf"
    | "word"
    | "excel"
    | "ppt"
    | "email"
    | "archive"
    | "other";

/**
 * Normalize a file_type value (e.g. "pdf") or a filename (e.g. "deck.pptx")
 * into a coarse kind used to pick an icon. Accepts both because some call
 * sites only have the filename (user-message files, citations) while others
 * carry the document's `file_type` field.
 */
export function fileTypeKind(value: string | null | undefined): FileTypeKind {
    const raw = (value ?? "").toLowerCase().trim();
    const ext = raw.includes(".") ? (raw.split(".").pop() ?? "") : raw;
    if (ext === "pdf") return "pdf";
    if (ext === "docx" || ext === "doc") return "word";
    if (ext === "xlsx" || ext === "xlsm" || ext === "xls") return "excel";
    if (ext === "pptx" || ext === "ppt") return "ppt";
    if (ext === "eml" || ext === "msg") return "email";
    if (ext === "zip") return "archive";
    return "other";
}

/**
 * Canonical document file-type icon. Size and any extra classes come from
 * `className`; `shrink-0` is always applied. `muted` renders a neutral grey
 * placeholder (used for loading/disabled rows).
 */
export function FileTypeIcon({
    fileType,
    className = "h-3.5 w-3.5",
    muted = false,
}: {
    fileType: string | null | undefined;
    className?: string;
    muted?: boolean;
}) {
    const cls = `${className} shrink-0`;
    const kind = fileTypeKind(fileType);
    if (muted) {
        const src =
            kind === "pdf"
                ? "/icons/file-types/pdf.svg"
                : kind === "word"
                  ? "/icons/file-types/word.svg"
                  : kind === "excel"
                    ? "/icons/file-types/excel.svg"
                    : kind === "ppt"
                      ? "/icons/file-types/ppt.svg"
                      : null;
        return src ? (
            <Image
                src={src}
                alt=""
                aria-hidden="true"
                width={64}
                height={64}
                unoptimized
                className={`${cls} object-contain grayscale opacity-35`}
            />
        ) : kind === "email" ? (
            <Mail className={`${cls} text-gray-300`} />
        ) : kind === "archive" ? (
            <FolderArchive className={`${cls} text-gray-300`} />
        ) : (
            <File className={`${cls} text-gray-300`} />
        );
    }
    switch (kind) {
        case "email":
            return <Mail className={`${cls} text-gray-500`} />;
        case "archive":
            return <FolderArchive className={`${cls} text-gray-500`} />;
        case "pdf":
            return (
                <Image
                    src="/icons/file-types/pdf.svg"
                    alt=""
                    aria-hidden="true"
                    width={64}
                    height={64}
                    unoptimized
                    className={`${cls} object-contain`}
                />
            );
        case "word":
            return (
                <Image
                    src="/icons/file-types/word.svg"
                    alt=""
                    aria-hidden="true"
                    width={64}
                    height={64}
                    unoptimized
                    className={`${cls} object-contain`}
                />
            );
        case "excel":
            return (
                <Image
                    src="/icons/file-types/excel.svg"
                    alt=""
                    aria-hidden="true"
                    width={64}
                    height={64}
                    unoptimized
                    className={`${cls} object-contain`}
                />
            );
        case "ppt":
            return (
                <Image
                    src="/icons/file-types/ppt.svg"
                    alt=""
                    aria-hidden="true"
                    width={64}
                    height={64}
                    unoptimized
                    className={`${cls} object-contain`}
                />
            );
        default:
            return <File className={`${cls} text-gray-500`} />;
    }
}
