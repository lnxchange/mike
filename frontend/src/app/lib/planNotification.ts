import type { PlanSettleReason } from "./planRun";

const BODIES: Record<PlanSettleReason, string> = {
    finished: "The plan is finished.",
    needs_input: "This needs an answer.",
    stopped: "This stopped and needs you to continue.",
};

const TITLE_PREFIX: Record<PlanSettleReason, string> = {
    finished: "Done · ",
    needs_input: "Needs an answer · ",
    stopped: "Stopped · ",
};

export function planSettleBody(reason: PlanSettleReason): string {
    return BODIES[reason];
}

export function planSettleTitlePrefix(reason: PlanSettleReason): string {
    return TITLE_PREFIX[reason];
}

/**
 * Notify only when the tab is in the background. A granted permission raises
 * a system notification. Otherwise the tab title carries the same news.
 */
export function settlePlanNotification(args: {
    hidden: boolean;
    permission: NotificationPermission | "unsupported";
    title: string;
    reason: PlanSettleReason;
    currentTitle: string;
}): { mode: "notification" | "title" | "none"; title: string; body: string } {
    const body = planSettleBody(args.reason);
    if (!args.hidden) {
        return { mode: "none", title: args.title, body };
    }
    if (args.permission === "granted") {
        return { mode: "notification", title: args.title, body };
    }
    const prefix = planSettleTitlePrefix(args.reason);
    const title = args.currentTitle.startsWith(prefix)
        ? args.currentTitle
        : `${prefix}${args.currentTitle}`;
    return { mode: "title", title, body };
}
