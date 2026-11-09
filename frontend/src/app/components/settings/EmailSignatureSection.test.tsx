import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailSignatureSection } from "./EmailSignatureSection";

const api = vi.hoisted(() => ({
    getOutlookSignature: vi.fn(),
    saveOutlookSignature: vi.fn(),
    refreshOutlookSignature: vi.fn(),
}));

vi.mock("@/app/lib/mikeApi", () => ({
    getOutlookSignature: api.getOutlookSignature,
    saveOutlookSignature: api.saveOutlookSignature,
    refreshOutlookSignature: api.refreshOutlookSignature,
}));

describe("EmailSignatureSection", () => {
    beforeEach(() => {
        api.getOutlookSignature.mockReset();
        api.saveOutlookSignature.mockReset();
        api.refreshOutlookSignature.mockReset();
        api.getOutlookSignature.mockResolvedValue({ html: null });
        api.saveOutlookSignature.mockImplementation(async (html: string) => ({
            html,
        }));
        api.refreshOutlookSignature.mockResolvedValue({
            html: "<div><b>Yule Guttenbeil</b><br>Principal</div>",
        });
    });

    it("saves an edited signature", async () => {
        const user = userEvent.setup();
        render(<EmailSignatureSection />);
        const editor = await screen.findByRole("textbox", {
            name: "Email signature",
        });
        await user.click(editor);
        await user.type(editor, "Yule Guttenbeil");
        await user.click(screen.getByRole("button", { name: "Save signature" }));
        await waitFor(() =>
            expect(api.saveOutlookSignature).toHaveBeenCalledWith(
                expect.stringContaining("Yule Guttenbeil"),
            ),
        );
        expect(await screen.findByText("Saved")).toBeInTheDocument();
    });

    it("replaces the field with the signature copied from Outlook", async () => {
        const user = userEvent.setup();
        render(<EmailSignatureSection />);
        await screen.findByRole("textbox", { name: "Email signature" });
        await user.click(
            screen.getByRole("button", { name: "Copy from Outlook" }),
        );
        expect(
            await screen.findByText("Yule Guttenbeil"),
        ).toBeInTheDocument();
        expect(screen.getByText("Principal")).toBeInTheDocument();
        expect(screen.getByText("Copied from Outlook")).toBeInTheDocument();
    });
});
