import { afterEach, describe, expect, it, vi } from "vitest";

import {
    bindTextSelectionBackdropSuspension,
    elementContainsTextSelection,
    syncTextSelectionAttribute,
} from "./suspendBackdropWhileSelecting";

function stubSelection(options: {
    collapsed?: boolean;
    text?: string;
    anchor?: Node | null;
    rangeCount?: number;
}): void {
    vi.spyOn(document, "getSelection").mockReturnValue({
        isCollapsed: options.collapsed ?? false,
        rangeCount: options.rangeCount ?? (options.collapsed ? 0 : 1),
        toString: () => options.text ?? "selected",
        anchorNode: options.anchor ?? document.body,
    } as unknown as Selection);
}

describe("text selection backdrop suspension", () => {
    afterEach(() => {
        document.documentElement.removeAttribute("data-text-selected");
        vi.restoreAllMocks();
    });

    it("marks the document while DOM text is selected", () => {
        stubSelection({ text: "the clause" });
        syncTextSelectionAttribute();
        expect(document.documentElement).toHaveAttribute("data-text-selected");
    });

    it("clears the mark when the selection collapses", () => {
        document.documentElement.setAttribute("data-text-selected", "");
        stubSelection({ collapsed: true, text: "", rangeCount: 0 });
        syncTextSelectionAttribute();
        expect(document.documentElement).not.toHaveAttribute(
            "data-text-selected",
        );
    });

    it("ignores a caret inside a field", () => {
        const field = document.createElement("textarea");
        document.body.appendChild(field);
        field.focus();
        field.value = "How can I help?";
        field.selectionStart = 3;
        field.selectionEnd = 3;
        stubSelection({ collapsed: true, text: "", rangeCount: 0 });
        syncTextSelectionAttribute();
        expect(document.documentElement).not.toHaveAttribute(
            "data-text-selected",
        );
        field.remove();
    });

    it("marks a field selection that window.getSelection cannot see", () => {
        const field = document.createElement("textarea");
        document.body.appendChild(field);
        field.focus();
        field.value = "How can I help?";
        field.selectionStart = 0;
        field.selectionEnd = 3;
        stubSelection({ collapsed: true, text: "", rangeCount: 0 });
        syncTextSelectionAttribute();
        expect(document.documentElement).toHaveAttribute("data-text-selected");
        field.remove();
    });

    it("follows selectionchange and removes the listener on cleanup", () => {
        const stop = bindTextSelectionBackdropSuspension();
        stubSelection({ text: "parties" });
        document.dispatchEvent(new Event("selectionchange"));
        expect(document.documentElement).toHaveAttribute("data-text-selected");

        stop();
        stubSelection({ text: "still selected" });
        document.dispatchEvent(new Event("selectionchange"));
        expect(document.documentElement).not.toHaveAttribute(
            "data-text-selected",
        );
    });

    it("reports whether a selection sits inside a scroller", () => {
        const scroller = document.createElement("div");
        const text = document.createTextNode("The parties agree");
        scroller.appendChild(text);
        document.body.appendChild(scroller);

        expect(
            elementContainsTextSelection(scroller, {
                isCollapsed: false,
                rangeCount: 1,
                toString: () => "parties",
                anchorNode: text,
            } as unknown as Selection),
        ).toBe(true);
        expect(
            elementContainsTextSelection(scroller, {
                isCollapsed: true,
                rangeCount: 0,
                toString: () => "",
                anchorNode: text,
            } as unknown as Selection),
        ).toBe(false);

        scroller.remove();
    });
});
