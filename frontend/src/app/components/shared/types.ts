import type { AssistantEvent as WireAssistantEvent } from "@mike/contracts";
// Shared TypeScript types for Mike AI legal assistant

import type {
  SourceDocument,
  SourceDocumentAction,
  SourceDocumentMetadata,
  SourceDocumentQuote,
  SourceDocumentType,
  SourceSubdocument,
} from "@mike/contracts";
import type {
  AskInputItem as SharedAskInputItem,
  AskInputResponseItem as SharedAskInputResponseItem,
  AskInputsEvent as SharedAskInputsEvent,
} from "@mike/contracts";

export interface Folder {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  parent_folder_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LibraryFolder {
  id: string;
  user_id: string;
  org_id?: string | null;
  library_kind: "file" | "template";
  name: string;
  parent_folder_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  source_label?: string;
  access_role?: "owner" | "editor" | "viewer";
  virtual?: boolean;
}

export type ResourceAccessScope = "private" | "shared" | "organization";

export interface Project {
  id: string;
  /** The creator. Null once an org project outlives the account that made it. */
  user_id: string;
  /** Provenance only: "created by me". Authorization reads access_role. */
  is_owner?: boolean;
  /**
   * Server-computed project role for the caller, already merged
   * strongest-wins across the creator, direct-grant and organization
   * branches. Returned by the detail endpoint and by the list RPCs.
   */
  access_role?: "owner" | "editor" | "viewer";
  /** The caller's role in the owning organization, if the project has one. */
  org_role?: "admin" | "member" | null;
  org_id?: string | null;
  access_scope?: ResourceAccessScope;
  organization_name?: string | null;
  direct_grant_count?: number;
  owner_display_name?: string | null;
  owner_email?: string | null;
  /**
   * Everyone who can administer this project, with an address. The
   * permission-denied popup needs it: telling somebody they were refused
   * without saying who to ask is a dead end.
   */
  admin_contacts?: {
    user_id: string | null;
    email: string | null;
    display_name: string | null;
    source: "creator" | "grant" | "organization";
  }[];
  name: string;
  cm_number: string | null;
  client_name?: string | null;
  description?: string | null;
  /** Zoho Deal id when this matter was pulled from Zoho. */
  zoho_deal_id?: string | null;
  /** SharePoint matter-folder URL from the Deal's SharePoint Link field. */
  sharepoint_folder_url?: string | null;
  practice: string | null;
  /** Whether this project's shared memory.md is active. */
  memory_enabled: boolean;
  created_at: string;
  updated_at: string;
  documents?: Document[];
  folders?: Folder[];
  document_count?: number;
  chat_count?: number;
  review_count?: number;
}

export interface Document {
  id: string;
  user_id?: string;
  project_id: string | null;
  workflow_id?: string | null;
  folder_id?: string | null;
  library_kind?: "file" | "template" | "workflow_asset";
  library_folder_id?: string | null;
  org_id?: string | null;
  source_label?: string;
  access_role?: "owner" | "editor" | "viewer";
  filename: string;
  owner_email?: string | null;
  owner_display_name?: string | null;
  file_type: string | null; // pdf | docx | doc | xlsx | xlsm | xls | pptx | ppt
  storage_path: string | null;
  pdf_storage_path: string | null;
  size_bytes: number | null;
  page_count: number | null;
  structure_tree: StructureNode[] | null;
  status: "pending" | "processing" | "ready" | "error";
  created_at: string | null;
  updated_at?: string | null;
  /** Stable id of the document version currently selected for this row. */
  current_version_id?: string | null;
  /** SHA-256 of the active version bytes; changes on in-place edits as well. */
  content_sha256?: string | null;
  /** Version number of the document row pointed to by current_version_id. */
  active_version_number?: number | null;
  /** Legacy: max version_number across assistant_edit rows, null if doc is unedited. */
  latest_version_number?: number | null;
  /**
   * Set when the document mirrors an item in an external store (today:
   * SharePoint, synced by the Attune filer). Null or absent for uploads.
   */
  external_provider?: string | null;
  external_item_id?: string | null;
  external_ctag?: string | null;
  external_web_url?: string | null;
  /** SharePoint / parsed correspondence. created_at remains ingest time. */
  email_subject?: string | null;
  email_from?: string | null;
  email_to?: string | null;
  email_received_at?: string | null;
}

export type PanelDocumentType = SourceDocumentType;
export type PanelDocumentMetadata = SourceDocumentMetadata;
export type PanelDocumentAction = SourceDocumentAction;
export type PanelDocumentQuote = SourceDocumentQuote;
export type PanelSubdocument = SourceSubdocument;
export type PanelDocument = SourceDocument;

export function isPanelDocument(value: unknown): value is PanelDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const document = value as Record<string, unknown>;
  return (
    typeof document.document_id === "string" &&
    typeof document.title === "string" &&
    ["docx", "pdf", "spreadsheet", "case", "legislation"].includes(
      String(document.type),
    ) &&
    Array.isArray(document.metadata) &&
    Array.isArray(document.quotes) &&
    (document.actions === undefined || Array.isArray(document.actions)) &&
    (document.subdocuments === undefined ||
      Array.isArray(document.subdocuments))
  );
}

export interface StructureNode {
  id: string;
  title: string;
  level: number;
  page_number: number | null;
  children: StructureNode[];
}

export interface Chat {
  id: string;
  project_id: string | null;
  user_id: string;
  org_id?: string | null;
  creator_display_name?: string | null;
  project_name?: string | null;
  title: string | null;
  model?: string | null;
  reasoning_level?: Message["reasoning"] | null;
  created_at: string;
  /** Provenance only: "I started this thread". Authorization reads
   *  access_role — an admin's standing on a colleague's chat is there. */
  is_owner?: boolean;
  /**
   * Server-computed role for the caller ON THIS CHAT, already merged
   * strongest-wins across the creator, direct-grant and project branches.
   * Served by GET /chat/:chatId and by the project chat list.
   */
  access_role?: "owner" | "editor" | "viewer";
}

export interface EditAnnotation {
  type?: "edit_data";
  kind?: "edit";
  edit_id: string;
  document_id: string;
  version_id: string;
  /** Per-document monotonic Vn for the edit's target version. */
  version_number?: number | null;
  change_id: string;
  del_w_id?: string;
  ins_w_id?: string;
  deleted_text: string;
  inserted_text: string;
  context_before?: string;
  context_after?: string;
  reason?: string;
  status: "pending" | "accepted" | "rejected";
}

export type AskInputItem = SharedAskInputItem;
export type AskInputResponseItem = SharedAskInputResponseItem;
export type AskInputsEvent = SharedAskInputsEvent;

export type AskInputsResponseEvent = {
  type: "ask_inputs_response";
  assistant_message_id: string;
  ask_event_id: string;
  responses: AskInputResponseItem[];
};

type WireActivity<T extends WireAssistantEvent["type"]> = Extract<
  WireAssistantEvent,
  { type: T }
>;
export type AssistantEvent =
  | (Omit<WireActivity<"reasoning">, "isStreaming"> & { isStreaming?: boolean })
  | (Omit<WireActivity<"error">, "safe_to_display"> & {
      safe_to_display?: boolean;
    })
  | {
      type: "tool_call_start";
      name: string;
      isStreaming?: boolean;
    }
  | (Omit<WireActivity<"mcp_tool_call">, "error" | "isStreaming"> & {
      error?: string;
      isStreaming?: boolean;
    })
  | AskInputsEvent
  | AskInputsResponseEvent
  | { type: "thinking"; isStreaming?: boolean }
  | (Omit<
      WireActivity<"doc_read">,
      "document_id" | "version_id" | "version_number" | "isStreaming"
    > & {
      document_id?: string;
      version_id?: string | null;
      version_number?: number | null;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"doc_find">,
      "document_id" | "version_id" | "version_number" | "isStreaming"
    > & {
      document_id?: string;
      version_id?: string | null;
      version_number?: number | null;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"doc_created">,
      "document_id" | "version_id" | "version_number" | "isStreaming"
    > & {
      document_id?: string;
      version_id?: string;
      version_number?: number | null;
      isStreaming?: boolean;
    })
  | WireActivity<"doc_download">
  | (Omit<
      WireActivity<"doc_replicated">,
      "copies" | "error" | "isStreaming"
    > & {
      copies?: {
        new_filename: string;
        document_id: string;
        version_id: string;
      }[];
      error?: string;
      isStreaming?: boolean;
    })
  | WireActivity<"workflow_applied">
  | (Omit<
      WireActivity<"doc_edited">,
      "version_number" | "annotations" | "error" | "isStreaming"
    > & {
      version_number?: number | null;
      annotations: EditAnnotation[];
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"doc_finalized">,
      | "document_id"
      | "version_id"
      | "version_number"
      | "source_document_id"
      | "download_url"
      | "accepted"
      | "comments_removed"
      | "error"
      | "isStreaming"
    > & {
      document_id?: string;
      version_id?: string;
      version_number?: number | null;
      source_document_id?: string;
      download_url?: string;
      accepted?: number;
      comments_removed?: number;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"courtlistener_search_case_law">,
      "result_count" | "error" | "isStreaming"
    > & { result_count?: number; error?: string; isStreaming?: boolean })
  | (Omit<
      WireActivity<"courtlistener_get_cases">,
      "case_count" | "opinion_count" | "cases" | "error" | "isStreaming"
    > & {
      case_count?: number;
      opinion_count?: number;
      cases?: {
        cluster_id: number;
        case_name: string | null;
        citation: string | null;
        dateFiled?: string | null;
        url?: string | null;
      }[];
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"courtlistener_find_in_case">,
      | "total_matches"
      | "case_name"
      | "citation"
      | "searches"
      | "error"
      | "isStreaming"
    > & {
      total_matches?: number;
      case_name?: string | null;
      citation?: string | null;
      searches?: {
        cluster_id: number | null;
        query: string;
        total_matches?: number;
        case_name?: string | null;
        citation?: string | null;
        error?: string;
      }[];
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"courtlistener_read_case">,
      "case_name" | "citation" | "opinion_count" | "error" | "isStreaming"
    > & {
      case_name?: string | null;
      citation?: string | null;
      opinion_count?: number;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"courtlistener_verify_citations">,
      "citation_count" | "match_count" | "error" | "isStreaming"
    > & {
      citation_count?: number;
      match_count?: number;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"au_search_legislation">,
      "result_count" | "error" | "isStreaming"
    > & { result_count?: number; error?: string; isStreaming?: boolean })
  | (Omit<
      WireActivity<"au_get_legislation">,
      "name" | "section" | "as_at" | "error" | "isStreaming"
    > & {
      name?: string | null;
      section?: string | null;
      as_at?: string | null;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"au_get_legislation_as_at">,
      "name" | "section" | "error" | "isStreaming"
    > & {
      name?: string | null;
      section?: string | null;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"au_legislation_versions">,
      "version_count" | "error" | "isStreaming"
    > & { version_count?: number; error?: string; isStreaming?: boolean })
  | (Omit<
      WireActivity<"au_find_in_legislation">,
      | "total_matches"
      | "name"
      | "searches"
      | "error"
      | "isStreaming"
    > & {
      total_matches?: number;
      name?: string | null;
      searches?: {
        title_id: string | null;
        query: string;
        total_matches?: number;
        name?: string | null;
        error?: string;
      }[];
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"au_search_energy">,
      "result_count" | "error" | "isStreaming"
    > & { result_count?: number; error?: string; isStreaming?: boolean })
  | (Omit<
      WireActivity<"au_get_energy">,
      "name" | "section" | "as_at" | "error" | "isStreaming"
    > & {
      name?: string | null;
      section?: string | null;
      as_at?: string | null;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"au_get_energy_as_at">,
      "name" | "section" | "error" | "isStreaming"
    > & {
      name?: string | null;
      section?: string | null;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"au_energy_versions">,
      "version_count" | "error" | "isStreaming"
    > & { version_count?: number; error?: string; isStreaming?: boolean })
  | (Omit<
      WireActivity<"au_find_in_energy">,
      "total_matches" | "name" | "error" | "isStreaming"
    > & {
      total_matches?: number;
      name?: string | null;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"au_search_vic_legislation">,
      "result_count" | "error" | "isStreaming"
    > & { result_count?: number; error?: string; isStreaming?: boolean })
  | (Omit<
      WireActivity<"au_get_vic_legislation">,
      "name" | "section" | "as_at" | "error" | "isStreaming"
    > & {
      name?: string | null;
      section?: string | null;
      as_at?: string | null;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"au_get_vic_legislation_as_at">,
      "name" | "section" | "error" | "isStreaming"
    > & {
      name?: string | null;
      section?: string | null;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"au_vic_legislation_versions">,
      "version_count" | "error" | "isStreaming"
    > & { version_count?: number; error?: string; isStreaming?: boolean })
  | (Omit<
      WireActivity<"au_find_in_vic_legislation">,
      "total_matches" | "name" | "error" | "isStreaming"
    > & {
      total_matches?: number;
      name?: string | null;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"au_search_case_law">,
      "result_count" | "error" | "isStreaming"
    > & { result_count?: number; error?: string; isStreaming?: boolean })
  | (Omit<
      WireActivity<"au_get_case">,
      "name" | "section" | "error" | "isStreaming"
    > & {
      name?: string | null;
      section?: string | null;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"au_find_in_case">,
      "total_matches" | "name" | "error" | "isStreaming"
    > & {
      total_matches?: number;
      name?: string | null;
      error?: string;
      isStreaming?: boolean;
    })
  | (Omit<
      WireActivity<"case_citation">,
      "pdfUrl" | "dateFiled" | "document"
    > & {
      pdfUrl?: string | null;
      dateFiled?: string | null;
      document?: PanelDocument;
    })
  | (Omit<
      WireActivity<"legislation_citation">,
      "document"
    > & {
      document?: PanelDocument;
    })
  | (Omit<WireActivity<"case_opinions">, "document"> & {
      document?: PanelDocument;
    })
  | (Omit<
      WireActivity<"outlook_draft_created">,
      "isStreaming"
    > & { isStreaming?: boolean })
  | (Omit<
      WireActivity<"outlook_auth_required">,
      "isStreaming"
    > & { isStreaming?: boolean })
  | (Omit<WireActivity<"content">, "isStreaming"> & { isStreaming?: boolean });

export type CaseCitationQuote = {
  opinionId: number | null;
  type: string | null;
  author: string | null;
  quote: string;
  verification?: QuoteVerification;
};

export type LegislationCitationQuote = {
  section: string | null;
  quote: string;
  verification?: QuoteVerification;
};

export interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  files?: MessageFile[];
  workflow?: { id: string; title: string };
  model?: string;
  reasoning?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  citations?: Citation[];
  citationStatus?: "started" | "partial" | "final";
  events?: AssistantEvent[];
  /** Set when streaming failed; rendered as a red error block. */
  error?: string;
  /**
   * "running" marks an assistant turn the server is still writing. The
   * transcript loader sets it so the page can reattach to the live stream
   * instead of treating the question as unanswered.
   */
  status?: "running";
  /** When the running turn started, from the server lease. */
  started_at?: string | null;
}

export type MessageFile = {
  filename: string;
  document_id?: string;
  version_id?: string | null;
  version_number?: number | null;
};

export interface CitationQuote {
  page?: number;
  quote: string;
}

export type QuoteVerification = {
  verified: boolean;
  source_excerpt?: string;
  start_char?: number;
  end_char?: number;
};

export type DocumentCitationQuote = {
  page: number | string;
  quote: string;
  verification?: QuoteVerification;
  /**
   * Spreadsheet citations are located by cell, not page: `sheet` is the
   * worksheet name and `cell` is an A1 address or range (e.g. "B7", "B7:C9").
   */
  sheet?: string;
  cell?: string;
};

export type DocumentCitation = {
  type: "citation_data";
  kind?: "document";
  ref: number;
  doc_id: string;
  document_id: string;
  version_id?: string | null;
  version_number?: number | null;
  filename: string;
  /** Legacy single-quote fields. Prefer `quotes` for new citations. */
  page: number | string;
  quote: string;
  sheet?: string;
  cell?: string;
  quotes?: DocumentCitationQuote[];
  /** True only when every quote was matched against the source. */
  verified?: boolean;
  document?: PanelDocument;
};

export type CaseCitation = {
  type: "citation_data";
  kind: "case";
  ref: number;
  cluster_id: number;
  case_name?: string | null;
  citation?: string | null;
  url?: string | null;
  pdfUrl?: string | null;
  dateFiled?: string | null;
  quotes: CaseCitationQuote[];
  /** True only when every quote was matched against the opinion text. */
  verified?: boolean;
  document?: PanelDocument;
};

export type LegislationCitation = {
  type: "citation_data";
  kind: "legislation";
  ref: number;
  title_id: string;
  name?: string | null;
  as_at?: string | null;
  url?: string | null;
  quotes: LegislationCitationQuote[];
  /** True only when every quote was matched against fetched register text. */
  verified?: boolean;
  document?: PanelDocument;
};

/**
 * A citation emitted by the assistant. Document citations have doc/page
 * anchors. Case citations anchor to a CourtListener cluster. Legislation
 * citations anchor to a Federal Register title and a quoted provision.
 */
export type Citation = DocumentCitation | CaseCitation | LegislationCitation;

export function panelDocumentType(filename: string): PanelDocumentType {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "docx" || extension === "doc") return "docx";
  if (extension === "xlsx" || extension === "xlsm" || extension === "xls") {
    return "spreadsheet";
  }
  return "pdf";
}

function legacyCaseSubdocumentId(clusterId: number, opinionId: number): string {
  return `case:${clusterId}:opinion:${opinionId}`;
}

export function panelDocumentFromCitation(
  citation: Citation,
  includeQuotes = true,
): PanelDocument {
  if (citation.document) {
    if (!includeQuotes) return { ...citation.document, quotes: [] };
    const citationQuotes =
      citation.kind === "case" || citation.kind === "legislation"
        ? citation.quotes
        : getDocumentCitationQuotes(citation);
    return {
      ...citation.document,
      quotes: citation.document.quotes.map((quote, index) => {
        const verifiedQuote = citationQuotes[index];
        return verifiedQuote
          ? {
              ...quote,
              quote: verifiedQuote.quote,
              ...(verifiedQuote.verification
                ? { verification: verifiedQuote.verification }
                : {}),
            }
          : quote;
      }),
    };
  }
  if (citation.kind === "legislation") {
    const title = citation.name?.trim() || citation.title_id;
    return {
      document_id: `legislation:${citation.title_id}${
        citation.as_at ? `:${citation.as_at}` : ""
      }`,
      title: title || "Legislation",
      type: "legislation",
      metadata: [
        { label: "Title ID", value: citation.title_id },
        ...(citation.as_at
          ? [{ label: "As at", value: citation.as_at, format: "date" as const }]
          : []),
      ],
      actions: citation.url
        ? [
            {
              type: "link" as const,
              url: citation.url,
              label: "Register",
              title: "Federal Register of Legislation",
            },
          ]
        : [],
      quotes: includeQuotes
        ? citation.quotes.map((quote) => ({
            quote: quote.quote,
            ...(quote.verification ? { verification: quote.verification } : {}),
            target: quote.section
              ? { subdocument_id: quote.section }
              : {},
          }))
        : [],
    };
  }
  if (citation.kind === "case") {
    const title = [citation.case_name, citation.citation]
      .filter(Boolean)
      .join(", ");
    return {
      document_id: `case:${citation.cluster_id}`,
      title: title || "Case",
      type: "case",
      metadata: citation.dateFiled
        ? [{ label: "Date", value: citation.dateFiled, format: "date" }]
        : [],
      actions: [
        ...(citation.pdfUrl
          ? [
              {
                type: "download" as const,
                url: citation.pdfUrl,
                label: "Download",
              },
            ]
          : []),
        ...(citation.url
          ? [
              {
                type: "link" as const,
                url: citation.url,
                label: "Link",
                title: "Link",
              },
            ]
          : []),
      ],
      quotes: includeQuotes
        ? citation.quotes.map((quote) => ({
            quote: quote.quote,
            ...(quote.verification ? { verification: quote.verification } : {}),
            target: {
              ...(typeof quote.opinionId === "number"
                ? {
                    subdocument_id: legacyCaseSubdocumentId(
                      citation.cluster_id,
                      quote.opinionId,
                    ),
                  }
                : {}),
            },
          }))
        : [],
    };
  }
  const quotes = getDocumentCitationQuotes(citation);
  return {
    document_id: citation.document_id,
    title: citation.filename,
    type: panelDocumentType(citation.filename),
    metadata: [],
    quotes: includeQuotes
      ? quotes.map((quote) => ({
          quote: quote.quote,
          ...(quote.verification ? { verification: quote.verification } : {}),
          target: {
            page: quote.page,
            ...(quote.sheet ? { sheet: quote.sheet } : {}),
            ...(quote.cell ? { cell: quote.cell } : {}),
          },
        }))
      : [],
    version_id: citation.version_id ?? null,
    version_number: citation.version_number ?? null,
  };
}

export function panelDocumentFromCaseEvent(
  event: Extract<AssistantEvent, { type: "case_citation" }>,
): PanelDocument | null {
  if (event.document) return event.document;
  if (!event.cluster_id) return null;
  return panelDocumentFromCitation({
    type: "citation_data",
    kind: "case",
    ref: 0,
    cluster_id: event.cluster_id,
    case_name: event.case_name,
    citation: event.citation,
    url: event.url,
    pdfUrl: event.pdfUrl,
    dateFiled: event.dateFiled,
    quotes: [],
  });
}

const PAGE_BREAK_SENTINEL = "[[PAGE_BREAK]]";

export function isSpreadsheetFilename(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext === "xlsx" || ext === "xlsm" || ext === "xls";
}

export function isDocxFilename(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext === "docx" || ext === "doc";
}

/**
 * Human-readable cell locator for a spreadsheet citation, e.g. "Sheet1!B7".
 * Falls back to whichever of `sheet`/`cell` is present.
 */
function formatCellLocator(sheet?: string, cell?: string): string {
  if (sheet && cell) return `${sheet}!${cell}`;
  return cell ?? sheet ?? "";
}

export function expandDocumentQuoteEntry(entry: {
  page?: number | string;
  quote: string;
}): CitationQuote[] {
  const rangeMatch =
    typeof entry.page === "string"
      ? entry.page.match(/^(\d+)\s*-\s*(\d+)$/)
      : null;
  if (rangeMatch && entry.quote.includes(PAGE_BREAK_SENTINEL)) {
    const startPage = parseInt(rangeMatch[1], 10);
    const endPage = parseInt(rangeMatch[2], 10);
    const [before, after] = entry.quote.split(PAGE_BREAK_SENTINEL);
    return [
      { page: startPage, quote: before.trim() },
      { page: endPage, quote: after.trim() },
    ].filter((e) => e.quote.length > 0);
  }
  const pageNum =
    typeof entry.page === "number"
      ? entry.page
      : parseInt(String(entry.page), 10);
  if (!Number.isFinite(pageNum)) return [];
  return [{ page: pageNum, quote: entry.quote }];
}

function getDocumentCitationQuotes(a: Citation): DocumentCitationQuote[] {
  if (a.kind === "case" || a.kind === "legislation") return [];
  if (Array.isArray(a.quotes) && a.quotes.length) {
    return a.quotes.filter((entry) => entry.quote.trim().length > 0);
  }
  return [{ page: a.page, quote: a.quote, sheet: a.sheet, cell: a.cell }];
}

/**
 * Expand a citation into one or more (page, quote) entries suitable for
 * highlighting in the PDF viewer. A single-page citation yields one entry; a
 * cross-page citation with page "N-M" and a `[[PAGE_BREAK]]` split yields two.
 */
export function expandCitationToEntries(a: Citation): CitationQuote[] {
  if (a.kind === "case" || a.kind === "legislation") return [];
  return getDocumentCitationQuotes(a).flatMap(expandDocumentQuoteEntry);
}

/**
 * Format the page(s) of a citation for display, e.g. "Page 3" or "Page 41-42".
 * Spreadsheets have no meaningful page locator, so this returns "" for them —
 * callers join with `.filter(Boolean)` so the locator is simply omitted.
 */
export function formatCitationPage(a: Citation): string {
  if (a.kind === "case") {
    return a.citation || a.case_name || `Case ${a.cluster_id}`;
  }
  if (a.kind === "legislation") {
    const sections = Array.from(
      new Set(a.quotes.map((quote) => quote.section).filter(Boolean)),
    );
    if (sections.length) return `s ${sections.join(", ")}`;
    return a.name || a.title_id;
  }
  const quotes = getDocumentCitationQuotes(a);
  // Spreadsheets are located by cell, e.g. "Sheet1!B7" (or several).
  if (isSpreadsheetFilename(a.filename)) {
    const cells = Array.from(
      new Set(
        quotes.map((q) => formatCellLocator(q.sheet, q.cell)).filter(Boolean),
      ),
    );
    return cells.join(", ");
  }
  const pages = Array.from(
    new Set(quotes.map((q) => String(q.page)).filter(Boolean)),
  );
  if (pages.length > 1) return `Pages ${pages.join(", ")}`;
  if (pages.length === 1) return `Page ${pages[0]}`;
  return `Page ${a.page}`;
}

/**
 * Reader-friendly version of a single raw quote: replaces [[PAGE_BREAK]] with
 * "...". Spreadsheet quotes now carry plain cell values, so no stripping.
 */
function cleanCitationQuoteText(rawQuote: string): string {
  return rawQuote.replaceAll(PAGE_BREAK_SENTINEL, "...");
}

/** Produce a reader-friendly version of the quote (replaces [[PAGE_BREAK]] with "..."). */
export function displayCitationQuote(a: Citation): string {
  if (a.kind === "case" || a.kind === "legislation") {
    return a.quotes
      .map((q) => q.quote.replaceAll(PAGE_BREAK_SENTINEL, "..."))
      .join(" / ");
  }
  return getDocumentCitationQuotes(a)
    .map((q) => cleanCitationQuoteText(q.quote))
    .filter(Boolean)
    .join(" / ");
}

// Tabular Review

export type ColumnFormat =
  | "text"
  | "bulleted_list"
  | "number"
  | "currency"
  | "yes_no"
  | "date"
  | "tag"
  | "percentage"
  | "monetary_amount";

export interface ColumnConfig {
  index: number;
  name: string;
  prompt: string;
  format?: ColumnFormat;
  tags?: string[];
}

export interface TabularReview {
  id: string;
  project_id: string | null;
  user_id: string;
  org_id?: string | null;
  title: string | null;
  /** Model pinned to this review. Null only for legacy/unconfigured rows. */
  model?: string | null;
  columns_config: ColumnConfig[] | null;
  document_ids?: string[] | null;
  document_grouping?: "document" | "folder";
  workflow_id: string | null;
  practice?: string | null;
  /** Server-set: true when the requesting user is the review's creator. */
  is_owner?: boolean;
  /** Server-set: true while another generation request holds the review lease. */
  is_running?: boolean;
  /** Server-computed role for the caller, from the detail endpoint and the
   *  overview RPC alike. */
  access_role?: "owner" | "editor" | "viewer";
  owner_email?: string | null;
  owner_display_name?: string | null;
  created_at: string;
  updated_at: string;
  document_count?: number;
}

export interface TabularCell {
  id: string;
  review_id: string;
  row_id: string;
  document_id: string | null;
  column_index: number;
  content: {
    summary: string;
    flag?: "green" | "grey" | "yellow" | "red";
    reasoning?: string;
  } | null;
  status: "pending" | "generating" | "done" | "error";
  created_at: string;
}

export interface TabularReviewRow {
  id: string;
  review_id: string;
  label: string;
  row_type: "document" | "folder";
  folder_id: string | null;
  library_folder_id: string | null;
  document_id: string | null;
  sort_index: number;
  source_document_ids: string[];
}

// Workflows

export interface WorkflowOpenSourceSubmission {
  id: string;
  status: "pending" | "approved" | "rejected";
  submitted_at: string;
  updated_at: string;
  reviewed_at?: string | null;
}

export interface OpenSourceWorkflowResponse extends WorkflowOpenSourceSubmission {
  mode: "created" | "updated";
}

export type OpenSourceWorkflowContributorMode = "named" | "anonymous";

export interface WorkflowContributor {
  name: string;
  organisation: string | null;
  role: string | null;
  linkedin: string | null;
}

export interface Workflow {
  id: string;
  user_id: string | null;
  org_id?: string | null;
  access_scope?: ResourceAccessScope;
  organization_name?: string | null;
  direct_grant_count?: number;
  metadata: {
    name?: string | null;
    title: string;
    description: string | null;
    type: "assistant" | "tabular";
    contributors: WorkflowContributor[];
    language: string;
    version: string | null;
    practice: string | null;
    jurisdictions: string[] | null;
  };
  skill_md: string | null;
  columns_config: ColumnConfig[] | null;
  is_system: boolean;
  is_default?: boolean;
  default_key?: string | null;
  created_at: string;
  shared_by_name?: string | null;
  allow_edit?: boolean;
  is_owner?: boolean;
  access_role?: "owner" | "editor" | "viewer";
  open_source_submission?: WorkflowOpenSourceSubmission | null;
}

export interface QuickAction {
  id: string;
  user_id: string;
  workflow_id: string;
  name: string;
  prompt: string;
  document_upload: boolean;
  surface: "app" | "word";
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  workflow: { id: string; title: string };
}

export interface WorkflowAddon {
  id: string;
  addon_key: string;
  pack_key: string | null;
  pack_title: string | null;
  pack_description: string | null;
  pack_version: string | null;
  version: string | null;
  title: string;
  description: string | null;
  type: "assistant" | "tabular";
  prompt_md?: string | null;
  columns_config?: ColumnConfig[] | null;
  contributors: WorkflowContributor[];
  language: string;
  practice: string | null;
  jurisdictions: string[] | null;
  active: boolean;
  updated_at: string;
  assets?: {
    id: string;
    filename: string;
    file_type: string;
    size_bytes: number | null;
    created_at: string;
  }[];
}

// API helpers

export interface ChatDetailOut {
  chat: Chat;
  messages: Message[];
}

export interface TabularReviewDetailOut {
  review: TabularReview;
  cells: TabularCell[];
  rows: TabularReviewRow[];
  documents: Document[];
}
