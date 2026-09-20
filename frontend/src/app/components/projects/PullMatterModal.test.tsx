import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    MikeApiError,
    pullZohoMatter,
    searchZohoMatters,
} from "@/app/lib/mikeApi";
import { PullMatterModal } from "./PullMatterModal";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace: vi.fn() }),
}));

// `importOriginal` keeps the real `MikeApiError`, which `userFacingApiError`
// recognises with `instanceof`.
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    searchZohoMatters: vi.fn(),
    pullZohoMatter: vi.fn(),
}));

const HITS = [
    {
        id: "deal-1",
        matterNumber: "263334",
        name: "Intellihub - VAPs - legal considerations",
        account: "Blue NRG",
        status: "Open",
        hasFolder: true,
    },
    {
        id: "deal-2",
        matterNumber: "263400",
        name: "AER - s87B Undertaking",
        account: "Blue NRG",
        status: "Open",
        hasFolder: false,
    },
];

async function typeQuery(user: ReturnType<typeof userEvent.setup>, q: string) {
    await user.type(screen.getByRole("searchbox"), q);
}

describe("PullMatterModal", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(searchZohoMatters).mockResolvedValue(HITS);
    });

    it("does not search until two characters have been typed, then debounces", async () => {
        const user = userEvent.setup();
        render(<PullMatterModal open onClose={vi.fn()} />);

        await typeQuery(user, "i");
        await new Promise((resolve) => setTimeout(resolve, 350));
        expect(searchZohoMatters).not.toHaveBeenCalled();

        await typeQuery(user, "nt");
        await waitFor(() =>
            expect(searchZohoMatters).toHaveBeenCalledWith("int"),
        );
        expect(searchZohoMatters).toHaveBeenCalledTimes(1);
    });

    it("lists hits as selectable options and disables one without a folder", async () => {
        const user = userEvent.setup();
        render(<PullMatterModal open onClose={vi.fn()} />);
        await typeQuery(user, "blue");

        const options = await screen.findAllByRole("option");
        expect(options).toHaveLength(2);
        expect(options[0]).toHaveTextContent("263334");
        expect(options[0]).toHaveTextContent("Blue NRG");
        expect(options[0]).toHaveAttribute("aria-selected", "false");
        expect(options[1]).toBeDisabled();
        expect(options[1]).toHaveTextContent("No SharePoint folder yet");

        const pull = screen.getByRole("button", {
            name: "Pull and keep in sync",
        });
        expect(pull).toBeDisabled();

        await user.click(options[0]);
        expect(options[0]).toHaveAttribute("aria-selected", "true");
        expect(pull).toBeEnabled();
    });

    it("pulls the selected matter and navigates to it", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        vi.mocked(pullZohoMatter).mockResolvedValue({
            projectId: "p-42",
            created: true,
            matterNumber: "263334",
            matterName: "Intellihub - VAPs",
            uploaded: 12,
            remaining: 40,
            status: "Syncing",
        });
        render(<PullMatterModal open onClose={onClose} />);
        await typeQuery(user, "intelli");
        await user.click((await screen.findAllByRole("option"))[0]);
        await user.click(
            screen.getByRole("button", { name: "Pull and keep in sync" }),
        );

        await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p-42"));
        expect(pullZohoMatter).toHaveBeenCalledWith({ matterId: "deal-1" });
        expect(onClose).toHaveBeenCalled();
    });

    it("shows the server's 4xx message and stays open when the pull is refused", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        vi.mocked(pullZohoMatter).mockRejectedValue(
            new MikeApiError({
                status: 409,
                code: "awaiting_folder",
                message:
                    "The SharePoint folder for this matter has not been created yet. It will sync automatically once it appears.",
            }),
        );
        render(<PullMatterModal open onClose={onClose} />);
        await typeQuery(user, "intelli");
        await user.click((await screen.findAllByRole("option"))[0]);
        await user.click(
            screen.getByRole("button", { name: "Pull and keep in sync" }),
        );

        expect(
            await screen.findByText(/has not been created yet/),
        ).toBeInTheDocument();
        expect(push).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it("never shows a raw server error", async () => {
        const user = userEvent.setup();
        vi.mocked(pullZohoMatter).mockRejectedValue(
            new MikeApiError({ status: 500, message: "boom from postgres" }),
        );
        render(<PullMatterModal open onClose={vi.fn()} />);
        await typeQuery(user, "intelli");
        await user.click((await screen.findAllByRole("option"))[0]);
        await user.click(
            screen.getByRole("button", { name: "Pull and keep in sync" }),
        );

        expect(
            await screen.findByText(/could not be pulled from Zoho/),
        ).toBeInTheDocument();
        expect(screen.queryByText(/postgres/)).not.toBeInTheDocument();
    });

    it("shows an empty state when nothing matches", async () => {
        const user = userEvent.setup();
        vi.mocked(searchZohoMatters).mockResolvedValue([]);
        render(<PullMatterModal open onClose={vi.fn()} />);
        await typeQuery(user, "zzzz");

        expect(await screen.findByText(/No projects found/)).toBeInTheDocument();
    });
});
