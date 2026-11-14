import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
    OutlookConnectBlock,
    OutlookDraftBlock,
    OutlookDraftPreviewBlock,
} from "./EventBlocks";

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
            screen.getByRole("link", { name: /see draft in outlook/i }),
        ).toHaveAttribute("href", "https://outlook.office.com/mail/draft");
        expect(
            screen.getByText(/ready for you to send/i),
        ).toBeInTheDocument();
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

    it("renders a chat preview with lists and asks the user to stage later", () => {
        render(
            <OutlookDraftPreviewBlock
                subject="Schedule"
                to={["alissa@example.com"]}
                htmlBody="<p>Please find <b>attached</b>:</p><ul><li>the schedule</li></ul><p>Kind regards,</p>"
                attachmentNames={["note.pdf"]}
            />,
        );
        expect(screen.getByText("Draft email")).toBeInTheDocument();
        expect(screen.getByText("Schedule")).toBeInTheDocument();
        expect(screen.getByText("the schedule")).toBeInTheDocument();
        expect(screen.getByText("attached")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /stage in outlook/i }),
        ).toBeDisabled();
        expect(
            screen.queryByRole("link", { name: /see draft in outlook/i }),
        ).not.toBeInTheDocument();
    });

    it("stages the draft already shown when Stage in Outlook is clicked", async () => {
        const user = userEvent.setup();
        const onStage = vi.fn().mockResolvedValue(undefined);
        render(
            <OutlookDraftPreviewBlock
                subject="Schedule"
                to={["alissa@example.com"]}
                htmlBody="<p>Kind regards,</p>"
                attachmentNames={[]}
                onStage={onStage}
            />,
        );
        await user.click(
            screen.getByRole("button", { name: /stage in outlook/i }),
        );
        expect(onStage).toHaveBeenCalledOnce();
    });

    it("points to Settings when Microsoft is not connected", () => {
        render(<OutlookConnectBlock />);
        expect(
            screen.getByRole("link", { name: /open settings/i }),
        ).toHaveAttribute("href", "/settings/security");
    });
});
