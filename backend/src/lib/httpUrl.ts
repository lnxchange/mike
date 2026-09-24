// Shared http(s) URL normaliser for stored outbound links.

export function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return trimmed;
}

const CHILD_FOLDER_PREFIXES = ["emails -", "dr -"];

/**
 * Walk from a SharePoint file URL up to the matter folder. Viewer links
 * (`_layouts/Doc.aspx`) have no path, so they return null. A file sitting in
 * `Emails - …` or `DR - …` is treated as belonging to that folder's parent.
 */
export function folderUrlFromSharepointDocumentUrl(
  value: unknown,
): string | null {
  if (!normalizeHttpUrl(value)) return null;
  const parsed = new URL((value as string).trim());
  if (parsed.pathname.toLowerCase().includes("/_layouts/")) return null;

  const segments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  if (segments.length < 2) return null;

  segments.pop();
  const leaf = segments[segments.length - 1]?.toLowerCase() ?? "";
  if (CHILD_FOLDER_PREFIXES.some((prefix) => leaf.startsWith(prefix))) {
    segments.pop();
  }
  if (segments.length === 0) return null;
  if (
    !segments.some((segment) => {
      const name = segment.toLowerCase();
      return name === "shared documents" || name === "documents";
    })
  ) {
    return null;
  }

  parsed.pathname = `/${segments.map(encodeURIComponent).join("/")}`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}
