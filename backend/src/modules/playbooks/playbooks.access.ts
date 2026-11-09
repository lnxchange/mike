export type PlaybookRole = "owner" | "editor" | "viewer";

export type PlaybookRow = {
    id: string;
    user_id: string;
    org_id: string | null;
    name: string;
    represented_party: string | null;
    description: string | null;
    visibility: "private" | "public";
    content: unknown;
    created_at: string;
    updated_at: string;
};

export function playbookRole(args: {
    playbook: Pick<PlaybookRow, "user_id" | "org_id" | "visibility">;
    userId: string;
    orgIds: ReadonlySet<string>;
    shareRole: "viewer" | "editor" | null;
}): PlaybookRole | null {
    if (args.playbook.user_id === args.userId) return "owner";
    if (args.shareRole === "editor") return "editor";
    if (args.shareRole === "viewer") return "viewer";
    if (
        args.playbook.visibility === "public" &&
        args.playbook.org_id &&
        args.orgIds.has(args.playbook.org_id)
    ) {
        return "viewer";
    }
    return null;
}

export function canEdit(role: PlaybookRole | null): boolean {
    return role === "owner" || role === "editor";
}

export function canRun(role: PlaybookRole | null): boolean {
    return role === "owner" || role === "editor" || role === "viewer";
}
