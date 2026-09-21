import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OutlookConnectBlock, OutlookDraftBlock } from "./EventBlocks";

describe("Outlook event cards", () => {
    it("shows Open in Outlook and matched-thread copy", () => {
        render(
            <OutlookDraftBlock
                subject="Schedule"
                to={["alissa@example.com"]}
                attachmentNames={["note.pdf"]}
                threaded
                threadStatus="matched"
                webLink="https://outlook.office.com/mail/draft"
            />,
        );
        expect(screen.getByText("Schedule")).toBeInTheDocument();
        expect(screen.getByText("To alissa@example.com")).toBeInTheDocument();
        expect(screen.getByText("Attached note.pdf")).toBeInTheDocument();
        expect(
            screen.getByText("This draft continues the existing conversation."),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("link", { name: /open in outlook/i }),
        ).toHaveAttribute("href", "https://outlook.office.com/mail/draft");
    });

    it("explains an ambiguous mailbox search as a new draft", () => {
        render(
            <OutlookDraftBlock
                subject="Schedule"
                to={["alissa@example.com"]}
                attachmentNames={[]}
                threaded={false}
                threadStatus="ambiguous"
            />,
        );
        expect(
            screen.getByText(
                "More than one matching conversation was found, so this is a new draft.",
            ),
        ).toBeInTheDocument();
    });

    it("points to Settings when Microsoft is not connected", () => {
        render(<OutlookConnectBlock />);
        expect(
            screen.getByRole("link", { name: /open settings/i }),
        ).toHaveAttribute("href", "/settings/security");
    });
});
