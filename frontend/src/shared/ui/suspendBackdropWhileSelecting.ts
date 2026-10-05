import { useEffect } from "react";

const TEXT_SELECTED_ATTRIBUTE = "data-text-selected";

/**
 * Chrome and WKWebView repaint in a loop for as long as a text selection
 * exists if any backdrop-filter is composited over that text. The chat
 * transcript sits under frosted headers and the composer, so selecting any
 * of it strobes the pane until the selection is cleared.
 *
 * The attribute is the switch the shared liquid-glass CSS uses to drop those
 * blurs for the life of the selection. Translucent fills stay put.
 */
export function syncTextSelectionAttribute(doc: Document = document): void {
    const root = doc.documentElement;
    const active = hasActiveTextSelection(doc);
    if (root.hasAttribute(TEXT_SELECTED_ATTRIBUTE) === active) return;
    root.toggleAttribute(TEXT_SELECTED_ATTRIBUTE, active);
}

export function bindTextSelectionBackdropSuspension(
    doc: Document = document,
): () => void {
    const update = (): void => syncTextSelectionAttribute(doc);
    doc.addEventListener("selectionchange", update);
    return () => {
        doc.removeEventListener("selectionchange", update);
        doc.documentElement.removeAttribute(TEXT_SELECTED_ATTRIBUTE);
    };
}

export function useSuspendBackdropWhileSelecting(): void {
    useEffect(() => bindTextSelectionBackdropSuspension(), []);
}

export function elementContainsTextSelection(
    element: HTMLElement,
    selection: Selection | null,
): boolean {
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return false;
    }
    if (selection.toString().length === 0) return false;
    const node = selection.anchorNode;
    return node !== null && element.contains(node);
}

function hasActiveTextSelection(doc: Document): boolean {
    const selection = doc.getSelection();
    if (
        selection &&
        !selection.isCollapsed &&
        selection.rangeCount > 0 &&
        selection.toString().length > 0
    ) {
        return true;
    }
    return fieldHasTextSelection(doc.activeElement);
}

function fieldHasTextSelection(element: Element | null): boolean {
    if (
        !(element instanceof HTMLTextAreaElement) &&
        !(element instanceof HTMLInputElement)
    ) {
        return false;
    }
    if (
        element instanceof HTMLInputElement &&
        element.type !== "text" &&
        element.type !== "search"
    ) {
        return false;
    }
    const start = element.selectionStart;
    const end = element.selectionEnd;
    return start !== null && end !== null && start !== end;
}
