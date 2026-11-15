import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import DOMPurify from "dompurify";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, ExternalLink, Loader2, Mail } from "lucide-react";
import {
    DocEditBlockUI,
    DocFindBlockUI,
    DocReadBlockUI,
    GLASS_CARD_SURFACE_CLASS,
    PillButtonUI,
    pillButtonUIClassName,
    useReasoningDisclosure,
} from "@mike/ui";
import { errorCode, userFacingApiError } from "@/app/lib/userFacingError";
import { useMarkdownCheckpoint } from "./markdownCheckpoint";
import {
    EventDisclosureButton,
    EventLabel,
} from "@/app/components/assistant/message/EventDisclosure";
import { WorkflowSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { VersionChip } from "@/app/components/shared/VersionChip";
import { API_BASE } from "@/app/lib/mikeApi";
import { authenticatedFetch } from "@/app/lib/authEvents";
import type { AssistantEvent } from "../../shared/types";
import { FileTypeIcon } from "../../shared/FileTypeIcon";
import { RESPONSE_GLASS_SURFACE, withoutMarkdownNode } from "./messageStyles";

const THINKING_PHRASES = [
    "Thinking...",
    "Pondering...",
    "Analyzing...",
    "Reviewing...",
    "Reasoning...",
];

// ---------------------------------------------------------------------------
// Event block primitives
// ---------------------------------------------------------------------------

function EventConnector() {
    return (
        <div
            aria-hidden="true"
            data-slot="event-connector"
            className="absolute w-[1px] bg-gray-300 top-[14px] left-[3px] translate-x-[-50%] h-[calc(100%+10px)]"
        />
    );
}

export function EventBlock({
    showConnector,
    isStreaming,
    dotColor = "green",
    children,
}: {
    showConnector?: boolean;
    isStreaming?: boolean;
    dotColor?: "green" | "gray" | "red";
    children: ReactNode;
}) {
    const dotColorClass =
        dotColor === "green"
            ? "bg-green-400 shadow-[0_1px_3px_rgba(15,23,42,0.15),inset_0_1px_0_rgba(255,255,255,0.5)]"
            : dotColor === "red"
              ? "bg-red-400 shadow-[0_1px_3px_rgba(15,23,42,0.15),inset_0_1px_0_rgba(255,255,255,0.5)]"
              : "bg-gray-500 shadow-[0_1px_3px_rgba(15,23,42,0.15)]";
    return (
        <div className="flex items-start text-sm font-serif text-gray-500 relative">
            {showConnector && <EventConnector />}
            {isStreaming ? (
                <div className="mt-2 w-1.5 h-1.5 shrink-0 rounded-full border border-gray-400 border-t-transparent animate-spin" />
            ) : (
                <div
                    className={`mt-2 w-1.5 h-1.5 shrink-0 rounded-full ${dotColorClass}`}
                />
            )}
            <div className="ml-2 min-w-0 flex-1 whitespace-normal break-words">
                {children}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------

export function ReasoningContent({
    text,
    label = "Thought process",
    streaming = false,
}: {
    text: string;
    label?: string;
    streaming?: boolean;
}) {
    const {richText, plainTail} = useMarkdownCheckpoint(text, streaming);
    const viewportRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [hasMoreBelow, setHasMoreBelow] = useState(false);
    const hasMoreBelowRef = useRef(false);

    useEffect(() => {
        const viewport = viewportRef.current;
        const content = contentRef.current;
        if (!viewport || !content) return;

        let frame: number | null = null;
        let disposed = false;
        const measure = () => {
            frame = null;
            if (disposed) return;
            const visible =
                viewport.scrollHeight > viewport.clientHeight &&
                viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 2;
            // Streaming can trigger many layout notifications. Dispatch only
            // when visibility changes, rather than on every incoming chunk.
            if (visible === hasMoreBelowRef.current) return;
            hasMoreBelowRef.current = visible;
            setHasMoreBelow(visible);
        };
        const scheduleMeasure = () => {
            if (!disposed && frame === null) {
                frame = requestAnimationFrame(measure);
            }
        };
        const observer = new ResizeObserver(scheduleMeasure);
        observer.observe(viewport);
        observer.observe(content);
        viewport.addEventListener("scroll", scheduleMeasure, { passive: true });
        scheduleMeasure();
        return () => {
            disposed = true;
            observer.disconnect();
            viewport.removeEventListener("scroll", scheduleMeasure);
            if (frame !== null) cancelAnimationFrame(frame);
        };
    }, []);

    return (
        <div className="relative mt-2">
            <div
                ref={viewportRef}
                role="region"
                aria-label={label}
                tabIndex={0}
                className="max-h-36 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
                <div
                    ref={contentRef}
                    className="text-sm font-serif text-gray-400 prose prose-sm max-w-none [&>*]:text-gray-400 [&>*]:text-sm"
                >
                    <ReasoningMarkdown text={richText} />
                    {plainTail && <span className="whitespace-pre-wrap">{plainTail}</span>}
                </div>
            </div>
            {hasMoreBelow && (
                <div
                    aria-hidden="true"
                    data-slot="reasoning-scroll-fade"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-10 backdrop-blur-xs [mask-image:linear-gradient(to_bottom,transparent,black)]"
                />
            )}
        </div>
    );
}

const ReasoningMarkdown = memo(function ReasoningMarkdown({text}: {text: string}) {
    return (<ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            code: (props) => (
                                <code
                                    className="font-serif text-gray-600"
                                    {...withoutMarkdownNode(props)}
                                />
                            ),
                        }}
                    >
                        {text}
                    </ReactMarkdown>);
});

export function ReasoningBlock({
    text,
    isStreaming,
    showConnector,
}: {
    text: string;
    isStreaming: boolean;
    showConnector?: boolean;
}) {
    const { isContentOpen, toggleContent } = useReasoningDisclosure(isStreaming);
    const [thinkingIndex, setThinkingIndex] = useState(0);

    useEffect(() => {
        if (!isStreaming) return;
        const interval = setInterval(() => {
            setThinkingIndex((i) => (i + 1) % THINKING_PHRASES.length);
        }, 2000);
        return () => clearInterval(interval);
    }, [isStreaming]);

    return (
        <EventBlock
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor="gray"
        >
            <EventDisclosureButton
                open={isContentOpen}
                onToggle={toggleContent}
                label={
                    isStreaming
                        ? THINKING_PHRASES[thinkingIndex]
                        : "Thought process"
                }
            />
            {isContentOpen && <ReasoningContent text={text} streaming={isStreaming} />}
        </EventBlock>
    );
}

export function DocReadBlock({
    filename,
    onClick,
    showConnector,
    isStreaming,
    interrupted,
    showFileIcon = true,
}: {
    filename: string;
    onClick?: () => void;
    showConnector?: boolean;
    isStreaming?: boolean;
    /** The turn ended before the read reported its result. */
    interrupted?: boolean;
    showFileIcon?: boolean;
}) {
    return (
        <DocReadBlockUI
            filename={filename}
            fileIcon={
                showFileIcon ? (
                    <FileTypeIcon fileType={filename} className="h-3.5 w-3.5" />
                ) : undefined
            }
            onClick={onClick}
            showConnector={showConnector}
            isStreaming={isStreaming}
            interrupted={interrupted}
        />
    );
}

export function DocFindBlock({
    filename,
    query,
    totalMatches,
    isStreaming,
    interrupted,
    showConnector,
    onClick,
}: {
    filename: string;
    query: string;
    totalMatches: number;
    isStreaming?: boolean;
    /** The turn ended before the find reported its matches. */
    interrupted?: boolean;
    showConnector?: boolean;
    onClick?: () => void;
}) {
    return (
        <DocFindBlockUI
            filename={filename}
            query={query}
            totalMatches={totalMatches}
            isStreaming={isStreaming}
            interrupted={interrupted}
            showConnector={showConnector}
            onClick={onClick}
        />
    );
}

export function DocCreatedBlock({
    filename,
    showConnector,
    isStreaming,
    interrupted,
    onClick,
}: {
    filename: string;
    showConnector?: boolean;
    isStreaming?: boolean;
    /** The turn ended before the document was reported as created. */
    interrupted?: boolean;
    onClick?: () => void;
}) {
    return (
        <EventBlock
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor={interrupted ? "gray" : "green"}
        >
            <div className="flex min-w-0 items-center gap-1.5">
                <EventLabel className="shrink-0">
                    {isStreaming
                        ? "Creating"
                        : interrupted
                          ? "Creation stopped"
                          : "Created"}
                </EventLabel>
                {isStreaming || !onClick ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                        <FileTypeIcon
                            fileType={filename}
                            className="h-3.5 w-3.5"
                        />
                        <span className="truncate">
                            {isStreaming ? `${filename}...` : filename}
                        </span>
                    </span>
                ) : (
                    <button
                        type="button"
                        onClick={onClick}
                        className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left transition-colors hover:text-gray-700"
                    >
                        <FileTypeIcon
                            fileType={filename}
                            className="h-3.5 w-3.5"
                        />
                        <span className="truncate">{filename}</span>
                    </button>
                )}
            </div>
        </EventBlock>
    );
}

function outlookThreadCopy(
    threaded?: boolean,
    threadStatus?: "matched" | "ambiguous" | "not_found" | "new",
) {
    if (threadStatus === "matched" || (threaded && !threadStatus)) {
        return "This draft continues the existing conversation.";
    }
    if (threadStatus === "ambiguous") {
        return "More than one matching conversation was found, so this is a new draft.";
    }
    if (threadStatus === "not_found") {
        return "No matching conversation was found, so this is a new draft.";
    }
    return "This is a new draft.";
}

const DRAFT_HTML_SANITIZER = {
    ALLOWED_TAGS: [
        "a",
        "b",
        "br",
        "div",
        "em",
        "i",
        "li",
        "ol",
        "p",
        "span",
        "strong",
        "u",
        "ul",
    ],
    ALLOWED_ATTR: ["href", "rel", "target"],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#)/i,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
};

const DRAFT_BODY_CLASS =
    "mt-3 font-serif text-[15px] leading-6 text-gray-900 [&_b]:font-semibold [&_i]:italic [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5";

function DraftEmailCard({
    subject,
    to,
    cc,
    htmlBody,
    attachmentNames,
    isStreaming,
    children,
}: {
    subject: string;
    to: string[];
    cc?: string[];
    htmlBody: string;
    attachmentNames: string[];
    isStreaming?: boolean;
    children?: ReactNode;
}) {
    const sanitizedBody = useMemo(
        () => (htmlBody ? DOMPurify.sanitize(htmlBody, DRAFT_HTML_SANITIZER) : ""),
        [htmlBody],
    );
    return (
        <section
            aria-label="Draft email"
            className={`${RESPONSE_GLASS_SURFACE} px-4 py-3 text-sm text-gray-800`}
        >
            <div className="flex min-w-0 items-center gap-2 text-gray-700">
                <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="font-medium">
                    {isStreaming ? "Drafting email" : "Draft email"}
                </span>
            </div>
            <p className="mt-2 truncate font-medium text-gray-950">
                {isStreaming ? subject || "Writing the draft" : subject}
            </p>
            {!isStreaming && to.length > 0 ? (
                <p className="mt-1 text-xs text-gray-500">To {to.join(", ")}</p>
            ) : null}
            {!isStreaming && cc && cc.length > 0 ? (
                <p className="text-xs text-gray-500">Cc {cc.join(", ")}</p>
            ) : null}
            {!isStreaming && attachmentNames.length > 0 ? (
                <p className="text-xs text-gray-500">
                    Attached {attachmentNames.join(", ")}
                </p>
            ) : null}
            {!isStreaming && sanitizedBody ? (
                <div
                    className={DRAFT_BODY_CLASS}
                    dangerouslySetInnerHTML={{ __html: sanitizedBody }}
                />
            ) : null}
            {!isStreaming ? children : null}
        </section>
    );
}

export function OutlookDraftPreviewBlock({
    subject,
    to,
    cc,
    htmlBody,
    attachmentNames,
    isStreaming,
    showConnector: _showConnector,
    onStage,
}: {
    subject: string;
    to: string[];
    cc?: string[];
    htmlBody: string;
    attachmentNames: string[];
    isStreaming?: boolean;
    showConnector?: boolean;
    onStage?: () => Promise<void>;
}) {
    const [staging, setStaging] = useState(false);
    const stagingRef = useRef(false);
    const [stageError, setStageError] = useState<string | null>(null);
    const [needsConnect, setNeedsConnect] = useState(false);

    async function stage() {
        if (!onStage || stagingRef.current) return;
        stagingRef.current = true;
        setStaging(true);
        setStageError(null);
        setNeedsConnect(false);
        try {
            await onStage();
        } catch (error) {
            if (errorCode(error) === "outlook_auth_required") {
                setNeedsConnect(true);
                setStageError(
                    "Connect Microsoft in Settings to stage this draft.",
                );
            } else {
                setStageError(
                    userFacingApiError(
                        error,
                        "The draft could not be staged. Please try again.",
                    ),
                );
            }
        } finally {
            stagingRef.current = false;
            setStaging(false);
        }
    }

    return (
        <DraftEmailCard
            subject={subject}
            to={to}
            cc={cc}
            htmlBody={htmlBody}
            attachmentNames={attachmentNames}
            isStreaming={isStreaming}
        >
            <div className="mt-3 flex flex-wrap items-center gap-3">
                <PillButtonUI
                    tone="black"
                    size="sm"
                    disabled={!onStage}
                    loading={staging}
                    onClick={() => void stage()}
                >
                    Stage in Outlook
                </PillButtonUI>
                {needsConnect ? (
                    <a
                        href="/settings/security"
                        className="text-xs font-medium text-gray-700 underline-offset-2 hover:text-gray-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2"
                    >
                        Open Settings
                    </a>
                ) : null}
            </div>
            <p className="mt-2 text-xs text-gray-500">
                {stageError ??
                    "This draft stays in the chat until you stage it. Your signature is added in Outlook."}
            </p>
        </DraftEmailCard>
    );
}

export function OutlookDraftBlock({
    subject,
    to,
    cc,
    htmlBody = "",
    attachmentNames,
    threaded,
    threadStatus,
    webLink,
    isStreaming,
    showConnector: _showConnector,
}: {
    subject: string;
    to: string[];
    cc?: string[];
    htmlBody?: string;
    attachmentNames: string[];
    threaded?: boolean;
    threadStatus?: "matched" | "ambiguous" | "not_found" | "new";
    webLink?: string;
    isStreaming?: boolean;
    showConnector?: boolean;
}) {
    return (
        <DraftEmailCard
            subject={subject}
            to={to}
            cc={cc}
            htmlBody={htmlBody}
            attachmentNames={attachmentNames}
            isStreaming={isStreaming}
        >
            <div className="mt-3 flex flex-wrap items-center gap-3">
                {webLink ? (
                    <a
                        href={webLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={pillButtonUIClassName({
                            tone: "black",
                            size: "sm",
                        })}
                    >
                        See draft in Outlook
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                ) : null}
            </div>
            <p className="mt-2 text-xs text-gray-500">
                {outlookThreadCopy(threaded, threadStatus)}
            </p>
            <p className="text-xs text-gray-500">
                This draft is in your Outlook, ready for you to send.
            </p>
        </DraftEmailCard>
    );
}

export function OutlookConnectBlock({
    showConnector,
}: {
    showConnector?: boolean;
}) {
    return (
        <EventBlock showConnector={showConnector} dotColor="gray">
            <div className="min-w-0">
                <EventLabel>Connect Microsoft</EventLabel>
                <p className="mt-1 text-xs text-gray-500">
                    Connect Microsoft in Settings to stage a review-only Outlook
                    draft.
                </p>
                <a
                    href="/settings/security"
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-gray-700 transition-colors hover:text-gray-950"
                >
                    Open Settings
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
            </div>
        </EventBlock>
    );
}

export function DocReplicatedBlock({
    filename,
    count,
    copies,
    showConnector,
    isStreaming,
    hasError,
    interrupted,
    onOpenCopy,
}: {
    filename: string;
    /**
     * How many consecutive replicates of this same source got collapsed
     * into this block. ≥ 1; only rendered when > 1.
     */
    count: number;
    copies?: {
        new_filename: string;
        document_id: string;
        version_id: string;
    }[];
    showConnector?: boolean;
    isStreaming?: boolean;
    hasError?: boolean;
    /** The turn ended before the replication reported its result. */
    interrupted?: boolean;
    onOpenCopy?: (copy: {
        new_filename: string;
        document_id: string;
        version_id: string;
    }) => void;
}) {
    const label = isStreaming
        ? "Replicating"
        : hasError
          ? "Replication failed"
          : interrupted
            ? "Replication stopped"
            : "Replicated";
    const suffix =
        !isStreaming && !hasError && !interrupted && count > 1
            ? ` ${count} times`
            : isStreaming
              ? "..."
              : "";
    return (
        <EventBlock
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor={hasError ? "red" : interrupted ? "gray" : "green"}
        >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <EventLabel className="shrink-0">{label}</EventLabel>
                {!isStreaming && copies?.length ? (
                    copies.map((copy, index) => (
                        <span
                            key={copy.document_id}
                            className="flex min-w-0 items-center gap-1.5"
                        >
                            {index > 0 && <span aria-hidden="true">,</span>}
                            <FileTypeIcon
                                fileType={copy.new_filename}
                                className="h-3.5 w-3.5 shrink-0"
                            />
                            {onOpenCopy ? (
                                <button
                                    type="button"
                                    onClick={() => onOpenCopy(copy)}
                                    className="min-w-0 cursor-pointer truncate text-left transition-colors hover:text-gray-700"
                                >
                                    {copy.new_filename}
                                </button>
                            ) : (
                                <span className="truncate">
                                    {copy.new_filename}
                                </span>
                            )}
                        </span>
                    ))
                ) : (
                    <span className="flex min-w-0 items-center gap-1.5">
                        <FileTypeIcon
                            fileType={filename}
                            className="h-3.5 w-3.5 shrink-0"
                        />
                        <span className="truncate">{filename}</span>
                        {suffix ? <span className="shrink-0">{suffix}</span> : null}
                    </span>
                )}
            </div>
        </EventBlock>
    );
}

export function DocDownloadBlock({
    filename,
    download_url,
    onOpen,
    isReloading = false,
    versionNumber,
}: {
    filename: string;
    download_url: string;
    onOpen?: () => void;
    isReloading?: boolean;
    versionNumber?: number | null;
}) {
    const extMatch = filename.match(/\.(\w+)$/);
    const rawBasename = extMatch
        ? filename.slice(0, -extMatch[0].length)
        : filename;
    // Strip any legacy "[Edited V3]" suffix that may still be baked into
    // older saved download filenames — the version is surfaced as a
    // separate tag now.
    const basename = rawBasename.replace(/\s*\[Edited V\d+\]\s*$/, "").trim();
    // Only backend-relative URLs are accepted. Downloads stay on the
    // same-origin gateway so HttpOnly auth cookies are never sent elsewhere.
    const isSafeHref = download_url.startsWith("/");
    const href = isSafeHref ? `${API_BASE}${download_url}` : null;
    const [busy, setBusy] = useState(false);

    const handleDownload = async (e?: {
        stopPropagation?: () => void;
        preventDefault?: () => void;
    }) => {
        e?.stopPropagation?.();
        e?.preventDefault?.();
        if (busy || isReloading || !href) return;
        setBusy(true);
        try {
            const resp = await authenticatedFetch(href);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } finally {
            setBusy(false);
        }
    };

    const spinning = busy || isReloading;

    // Scale with the chat column rather than the viewport: a docked panel
    // can be narrow on a wide screen. The name truncates beside the download
    // button; the full name stays available as a tooltip.
    const body = (
        <div className="flex items-center gap-2 px-3 py-2.5 min-w-0 flex-1 @md:gap-3 @md:px-4 @md:py-3">
            <FileTypeIcon fileType={filename} className="h-3.5 w-3.5 @md:h-4 @md:w-4" />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                    <p
                        title={basename}
                        className="min-w-0 truncate text-sm font-serif text-gray-900 @md:text-lg"
                    >
                        {basename}
                    </p>
                    <VersionChip n={versionNumber} size="lg" />
                </div>
            </div>
        </div>
    );

    const downloadIcon = spinning ? (
        <div
            aria-disabled
            className="shrink-0 flex items-center bg-white/25 px-4 text-gray-400 cursor-not-allowed @md:px-6"
        >
            <Loader2 className="size-3 animate-spin @md:size-[13px]" />
        </div>
    ) : (
        <button
            type="button"
            onClick={handleDownload}
            aria-label={`Download ${filename}`}
            className="shrink-0 flex items-center bg-white/25 px-4 text-gray-500 transition-colors hover:bg-white/55 hover:text-gray-700 cursor-pointer @md:px-6"
        >
            <Download className="size-3 @md:size-[13px]" />
        </button>
    );

    if (onOpen) {
        return (
            <div
                className={`@container flex items-stretch overflow-hidden w-full font-serif ${RESPONSE_GLASS_SURFACE}`}
            >
                <button
                    type="button"
                    onClick={onOpen}
                    className="flex items-stretch flex-1 min-w-0 text-left transition-colors hover:bg-white/45 cursor-pointer"
                >
                    {body}
                </button>
                {downloadIcon}
            </div>
        );
    }

    if (spinning) {
        return (
            <div
                className={`@container flex items-stretch overflow-hidden w-full font-serif ${RESPONSE_GLASS_SURFACE}`}
            >
                {body}
                {downloadIcon}
            </div>
        );
    }

    return (
        <div
            className={`@container flex items-stretch overflow-hidden w-full font-serif ${RESPONSE_GLASS_SURFACE}`}
        >
            <button
                type="button"
                onClick={handleDownload}
                className="flex items-stretch flex-1 min-w-0 text-left transition-colors hover:bg-white/45 cursor-pointer"
            >
                {body}
            </button>
            {downloadIcon}
        </div>
    );
}

export function WorkflowAppliedBlock({
    title,
    showConnector,
    onClick,
}: {
    title: string;
    showConnector?: boolean;
    onClick?: () => void;
}) {
    return (
        <EventBlock showConnector={showConnector} dotColor="green">
            <div className="flex min-w-0 items-center gap-1.5">
                <EventLabel className="shrink-0">Read</EventLabel>
                {onClick ? (
                    <button
                        type="button"
                        onClick={onClick}
                        aria-label={`Open workflow ${title}`}
                        className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left transition-colors hover:text-gray-700"
                    >
                        <WorkflowSkeuoIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{title}</span>
                    </button>
                ) : (
                    <span className="flex min-w-0 items-center gap-1.5">
                        <WorkflowSkeuoIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{title}</span>
                    </span>
                )}
            </div>
        </EventBlock>
    );
}

export function AskInputsBlock({
    event,
    response,
    showConnector,
}: {
    event: Extract<AssistantEvent, { type: "ask_inputs" }>;
    response?: Extract<AssistantEvent, { type: "ask_inputs_response" }>;
    showConnector?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(!response);
    const responseById = new Map(
        response?.responses.map((item) => [item.id, item]) ?? [],
    );
    const onlyApprovals = event.items.every((item) => item.kind === "approval");
    const label = onlyApprovals
        ? response
            ? "Asked for approval"
            : "Asking for approval"
        : response
          ? "Asked for input"
          : "Asking for input";
    return (
        <EventBlock
            showConnector={showConnector}
            dotColor={response ? "green" : "gray"}
        >
            <EventDisclosureButton
                open={isOpen}
                onToggle={() => setIsOpen((open) => !open)}
                label={label}
            />
            {isOpen && (
                <div className="mt-2 space-y-2 text-gray-800">
                    {event.items.map((item, index) => {
                        const itemResponse = responseById.get(item.id);
                        const responseText = (() => {
                            if (!itemResponse) return null;
                            if (itemResponse.kind === "approval")
                                return itemResponse.decision === "approve"
                                    ? "Approved"
                                    : "Rejected";
                            if (itemResponse.skipped) return "Skipped";
                            if (itemResponse.kind === "multi_choice") {
                                return itemResponse.answers?.join(", ") ?? "";
                            }
                            if (itemResponse.kind !== "documents") {
                                return itemResponse.answer ?? "";
                            }
                            const filenames = itemResponse.filenames;
                            return filenames.length
                                ? filenames.join(", ")
                                : "No documents attached";
                        })();
                        return (
                            <div key={item.id}>
                                <p className="text-xs text-gray-500">
                                    {index + 1}.{" "}
                                    {item.kind === "documents"
                                        ? "Documents"
                                        : item.kind === "approval"
                                          ? "Approval"
                                          : "Question"}
                                </p>
                                <p className="mt-0.5 [overflow-wrap:anywhere]">
                                    {item.kind === "documents"
                                        ? item.document_types.join(", ") ||
                                          "Documents requested"
                                        : item.kind === "approval"
                                          ? `${item.connector_name}: ${item.title}`
                                          : item.question}
                                </p>
                                {responseText !== null && (
                                    <p className="mt-0.5 text-gray-600">
                                        {responseText}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </EventBlock>
    );
}

const PLAN_STATUS_LABEL: Record<
    Extract<AssistantEvent, { type: "plan" }>["items"][number]["status"],
    string
> = {
    pending: "Pending",
    in_progress: "In progress",
    completed: "Done",
};

export function PlanBlock({
    event,
}: {
    event: Extract<AssistantEvent, { type: "plan" }>;
}) {
    return (
        <div className={`${GLASS_CARD_SURFACE_CLASS} px-4 py-3`}>
            <p className="font-serif text-sm text-gray-900">{event.title}</p>
            <ol className="mt-2 space-y-1.5">
                {event.items.map((item, index) => (
                    <li
                        key={item.id}
                        className="font-serif text-sm text-gray-700"
                    >
                        <span className="text-gray-500">
                            {index + 1}. {PLAN_STATUS_LABEL[item.status]}
                        </span>
                        <span className="ml-2">{item.content}</span>
                    </li>
                ))}
            </ol>
        </div>
    );
}

export type CourtListenerBlockItem = {
    caseName: string | null;
    citation: string | null;
    dateFiled?: string | null;
    url?: string | null;
    query?: string;
    totalMatches?: number;
    hasError?: boolean;
};

export function CourtListenerBlock({
    label,
    detail,
    isStreaming,
    hasError,
    interrupted,
    showConnector,
    items,
}: {
    label: string;
    detail?: string;
    isStreaming?: boolean;
    hasError?: boolean;
    /** The turn ended before the call reported its result. */
    interrupted?: boolean;
    showConnector?: boolean;
    items?: CourtListenerBlockItem[];
}) {
    const [isOpen, setIsOpen] = useState(false);
    const hasItems = !!items && items.length > 0;
    return (
        <EventBlock
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor={hasError ? "red" : interrupted ? "gray" : "green"}
        >
            {hasItems ? (
                <EventDisclosureButton
                    open={isOpen}
                    onToggle={() => setIsOpen((v) => !v)}
                    label={label}
                    detail={detail}
                    isStreaming={isStreaming}
                />
            ) : (
                <>
                    <EventLabel>{label}</EventLabel>
                    {detail ? <span>&nbsp;{detail}</span> : null}
                    {isStreaming ? <span>...</span> : null}
                </>
            )}
            {isOpen && hasItems && (
                <ul className="mt-2 flex flex-col gap-1 text-sm font-serif text-gray-500">
                    {items!.map((item, idx) => {
                        const label = [item.caseName, item.citation]
                            .filter(Boolean)
                            .join(", ");
                        const primary = label || item.url || "Unknown case";
                        // A stopped call never reported these searches, so
                        // they are named, not claimed as done.
                        const searchText = item.query
                            ? `${interrupted ? "Search for" : "Searched for"} "${item.query}" in ${primary}${
                                  typeof item.totalMatches === "number"
                                      ? ` (${item.totalMatches} ${
                                            item.totalMatches === 1
                                                ? "match"
                                                : "matches"
                                        })`
                                      : ""
                              }`
                            : null;
                        return (
                            <li key={idx}>
                                <div
                                    className={
                                        item.hasError ? "text-red-500" : ""
                                    }
                                >
                                    {item.url ? (
                                        <a
                                            href={item.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="hover:text-gray-700 hover:underline underline-offset-2"
                                        >
                                            {searchText ?? primary}
                                        </a>
                                    ) : searchText ? (
                                        <span>{searchText}</span>
                                    ) : (
                                        <span>{primary}</span>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </EventBlock>
    );
}

export function DocFinalizedBlock({
    filename,
    sourceFilename,
    accepted,
    showConnector,
    isStreaming,
    hasError,
    onClick,
}: {
    filename: string;
    sourceFilename?: string;
    accepted?: number;
    showConnector?: boolean;
    isStreaming?: boolean;
    hasError?: boolean;
    onClick?: () => void;
}) {
    const label = isStreaming
        ? "Finalising"
        : hasError
          ? "Finalise failed"
          : "Clean copy";
    const detail =
        !isStreaming && !hasError && typeof accepted === "number"
            ? `${accepted} change${accepted === 1 ? "" : "s"} accepted from ${sourceFilename ?? "the marked-up file"}`
            : undefined;

    return (
        <DocEditBlockUI
            label={label}
            filename={isStreaming ? sourceFilename ?? filename : filename}
            detail={detail}
            onClick={onClick}
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor={hasError ? "red" : "green"}
        />
    );
}

export function DocEditBlock({
    filename,
    showConnector,
    isStreaming,
    hasError,
    interrupted,
    onClick,
}: {
    filename: string;
    showConnector?: boolean;
    isStreaming?: boolean;
    hasError?: boolean;
    /** The turn ended before the edit reported its result. */
    interrupted?: boolean;
    onClick?: () => void;
}) {
    const label = isStreaming
        ? "Editing"
        : hasError
          ? "Edit failed"
          : interrupted
            ? "Edit stopped"
            : "Edited";

    return (
        <DocEditBlockUI
            label={label}
            filename={filename}
            fileIcon={
                <FileTypeIcon fileType={filename} className="h-3.5 w-3.5" />
            }
            onClick={onClick}
            showConnector={showConnector}
            isStreaming={isStreaming}
            dotColor={hasError ? "red" : interrupted ? "gray" : "green"}
        />
    );
}
