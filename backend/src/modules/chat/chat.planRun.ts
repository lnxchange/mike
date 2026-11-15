// Server-owned plan slices.
//
// A long job is still one model call at a time. When a slice stops with work
// left, this starts the next call on the same assistant message after the
// lease is free. No user row is inserted. The active plan already rides along
// in the prior-turn context.

import type { AssistantEvent } from "@mike/contracts";
import { withAuExecutionBlocksPrompt } from "../../lib/auExecutionBlocks";
import {
    checkProjectAccess,
    projectHasSharedAudience,
} from "../../lib/access";
import { hasDirectContentGrants } from "../../lib/contentAccess";
import type { ReasoningLevel, UserApiKeys } from "../../lib/llm";
import { can } from "../../lib/permissions";
import type { Db } from "../../lib/supabase";
import { resolveUserChatSelection } from "../user/user.service";
import { getAccessibleChat } from "./chat.access";
import { getChatMessages } from "./chat.messages";
import {
    bindChatTurnStream,
    claimChatTurn,
    releaseChatTurn,
} from "./chat.turns";
import {
    ASSISTANT_ERROR_MESSAGE,
    buildDocContext,
    buildMessages,
    buildUserPersonalisationPrompt,
    buildWorkflowStore,
    enrichWithPriorEvents,
    generateSpotlightNonce,
    PROJECT_EXTRA_TOOLS,
    runLLMStream,
    stripTransientAssistantEvents,
    type ChatMessage,
} from "./engine/index";
import {
    decidePlanContinuation,
    latestPlanEvent,
    mergePlanSliceEvents,
    planStatusKey,
    type PlanSliceStop,
} from "./engine/tools/planTools";

export type PlanSliceResult = {
    events: AssistantEvent[];
    cancelled: boolean;
    /** Another request already holds the chat. Do not treat that as a stall. */
    busy?: boolean;
    citations?: unknown[];
};

export type PlanChainDeps = {
    slicesCompleted: number;
    previousStatusKey: string | null;
    userResume?: boolean;
    loadEvents: () => Promise<AssistantEvent[]>;
    runSlice: (planEventId: string | null) => Promise<PlanSliceResult>;
    saveMerged: (
        existing: AssistantEvent[],
        slice: PlanSliceResult,
    ) => Promise<void>;
};

const activeChains = new Set<string>();

export async function runPlanChain(
    deps: PlanChainDeps,
): Promise<{ slicesRun: number; stop: PlanSliceStop | null }> {
    let slicesCompleted = deps.slicesCompleted;
    let previousStatusKey = deps.previousStatusKey;
    let userResume = deps.userResume === true;
    let slicesRun = 0;
    let stop: PlanSliceStop | null = null;

    for (;;) {
        const existing = await deps.loadEvents();
        const decision = decidePlanContinuation({
            events: existing,
            slicesCompleted,
            previousStatusKey,
            userResume,
        });
        if (!decision.continue) {
            stop = decision.stop;
            break;
        }
        const plan = latestPlanEvent(existing);
        const keyBefore = planStatusKey(plan);
        const slice = await deps.runSlice(plan?.event_id ?? null);
        if (slice.busy) break;
        await deps.saveMerged(existing, slice);
        slicesRun += 1;
        slicesCompleted += 1;
        previousStatusKey = keyBefore;
        userResume = false;
        if (slice.cancelled) {
            stop = "cancelled";
            break;
        }
    }

    return { slicesRun, stop };
}

export type PlanContinuationRequest = {
    db: Db;
    userId: string;
    userEmail?: string | null;
    chatId: string;
    assistantMessageId: string;
    slicesCompleted: number;
    previousStatusKey: string | null;
    userResume?: boolean;
};

function storedEvents(content: unknown): AssistantEvent[] {
    if (!Array.isArray(content)) return [];
    return content.filter(
        (event): event is AssistantEvent =>
            !!event && typeof event === "object" && !Array.isArray(event),
    );
}

function storedMessagesToChatMessages(
    rows: Record<string, unknown>[],
): ChatMessage[] {
    const messages: ChatMessage[] = [];
    for (const row of rows) {
        if (row.role === "user") {
            messages.push({
                role: "user",
                content: typeof row.content === "string" ? row.content : "",
                files: Array.isArray(row.files)
                    ? (row.files as ChatMessage["files"])
                    : undefined,
                workflow:
                    row.workflow && typeof row.workflow === "object"
                        ? (row.workflow as ChatMessage["workflow"])
                        : undefined,
            });
            continue;
        }
        if (row.role !== "assistant" || !Array.isArray(row.content)) continue;
        const text = storedEvents(row.content)
            .filter(
                (event): event is Extract<AssistantEvent, { type: "content" }> =>
                    event.type === "content",
            )
            .map((event) => event.text)
            .join("");
        if (!text.trim()) continue;
        messages.push({ role: "assistant", content: text });
    }
    return messages;
}

async function loadAssistantRow(
    db: Db,
    chatId: string,
    assistantMessageId: string,
): Promise<{ content: unknown; citations: unknown } | null> {
    const { data, error } = await db
        .from("chat_messages")
        .select("content, citations")
        .eq("chat_id", chatId)
        .eq("id", assistantMessageId)
        .eq("role", "assistant")
        .maybeSingle();
    if (error || !data) return null;
    return data as { content: unknown; citations: unknown };
}

/**
 * Start the next slices without waiting for the HTTP request that just
 * finished. A second schedule for the same message is ignored.
 */
export function schedulePlanContinuation(args: PlanContinuationRequest): void {
    if (activeChains.has(args.assistantMessageId)) return;
    activeChains.add(args.assistantMessageId);
    setImmediate(() => {
        void executePlanContinuation(args)
            .catch((error) => {
                console.error("[plan] continuation failed", error);
            })
            .finally(() => {
                activeChains.delete(args.assistantMessageId);
            });
    });
}

async function executePlanContinuation(
    args: PlanContinuationRequest,
): Promise<void> {
    await runPlanChain({
        slicesCompleted: args.slicesCompleted,
        previousStatusKey: args.previousStatusKey,
        userResume: args.userResume,
        loadEvents: async () => {
            const row = await loadAssistantRow(
                args.db,
                args.chatId,
                args.assistantMessageId,
            );
            return storedEvents(row?.content);
        },
        runSlice: (planEventId) => runContinuationSlice(args, planEventId),
        saveMerged: async (existing, slice) => {
            const row = await loadAssistantRow(
                args.db,
                args.chatId,
                args.assistantMessageId,
            );
            const merged = mergePlanSliceEvents(
                existing,
                stripTransientAssistantEvents(slice.events),
            );
            const priorCitations = Array.isArray(row?.citations)
                ? row.citations
                : [];
            const { error } = await args.db
                .from("chat_messages")
                .update({
                    content: merged,
                    citations: [
                        ...priorCitations,
                        ...(slice.citations ?? []),
                    ],
                })
                .eq("chat_id", args.chatId)
                .eq("id", args.assistantMessageId);
            if (error) {
                console.error("[plan] failed to save continuation", error);
            }
        },
    });
}

async function runContinuationSlice(
    args: PlanContinuationRequest,
    planEventId: string | null,
): Promise<PlanSliceResult> {
    const claim = await claimChatTurn(args.db, {
        chatId: args.chatId,
        assistantMessageId: args.assistantMessageId,
    });
    if (!claim.ok) return { events: [], cancelled: false, busy: true };

    const turn = bindChatTurnStream({
        db: args.db,
        lease: claim.lease,
        userId: args.userId,
        fallbackSignal: new AbortController().signal,
        write: () => true,
    });
    let citations: unknown[] = [];
    try {
        const prepared = await prepareContinuationContext(args);
        if (!prepared.ok) {
            return {
                events: [
                    {
                        type: "error",
                        message: ASSISTANT_ERROR_MESSAGE,
                    },
                ],
                cancelled: false,
            };
        }
        const result = await runLLMStream({
            apiMessages: prepared.apiMessages,
            docStore: prepared.docStore,
            docIndex: prepared.docIndex,
            userId: args.userId,
            db: args.db,
            write: (line) => {
                turn.write(line);
            },
            ...(prepared.extraTools
                ? { extraTools: prepared.extraTools }
                : {}),
            allowDocumentMutation: prepared.allowDocumentMutation,
            workflowStore: prepared.workflowStore,
            includeUsResearchTools: prepared.legalResearchUs,
            includeAuResearchTools: prepared.legalResearchAu,
            includeAuEnergyResearchTools: prepared.legalResearchAuEnergy,
            includeAuVicResearchTools: prepared.legalResearchAuVic,
            includeAuCasesResearchTools: prepared.legalResearchAuCases,
            model: prepared.selectedModel,
            reasoning: prepared.selectedReasoningLevel,
            apiKeys: prepared.apiKeys,
            signal: turn.signal,
            projectId: prepared.projectId,
            includeMemory: true,
            memoryProjectId: prepared.memoryProjectId,
            memorySharedAudience: prepared.memorySharedAudience,
            nonce: prepared.nonce,
            planEventId: planEventId ?? undefined,
            suppressPlanPauseContent: true,
            emitDone: false,
        });
        citations = result.citations;
        turn.write("data: [DONE]\n\n");
        return {
            events: result.events,
            cancelled: turn.signal.aborted,
            citations,
        };
    } catch (error) {
        console.error("[plan] slice failed", error);
        return {
            events: [{ type: "error", message: ASSISTANT_ERROR_MESSAGE }],
            cancelled: turn.signal.aborted,
        };
    } finally {
        turn.finish();
        await releaseChatTurn(args.db, claim.lease);
    }
}

type BuiltDocContext = Awaited<ReturnType<typeof buildDocContext>>;

type PreparedContinuation =
    | { ok: false }
    | {
          ok: true;
          apiMessages: ReturnType<typeof buildMessages>;
          docStore: BuiltDocContext["docStore"];
          docIndex: BuiltDocContext["docIndex"];
          workflowStore: Awaited<ReturnType<typeof buildWorkflowStore>>;
          extraTools?: typeof PROJECT_EXTRA_TOOLS;
          allowDocumentMutation: boolean;
          legalResearchUs: boolean;
          legalResearchAu: boolean;
          legalResearchAuEnergy: boolean;
          legalResearchAuVic: boolean;
          legalResearchAuCases: boolean;
          selectedModel: string;
          selectedReasoningLevel: ReasoningLevel;
          apiKeys: UserApiKeys;
          projectId: string | null;
          memoryProjectId: string | null;
          memorySharedAudience: boolean;
          nonce: string;
      };

async function prepareContinuationContext(
    args: PlanContinuationRequest,
): Promise<PreparedContinuation> {
    const access = await getAccessibleChat(args.db, {
        chatId: args.chatId,
        userId: args.userId,
        userEmail: args.userEmail,
    });
    if (!access.ok || !can(access.projectRole, "content.edit")) {
        return { ok: false };
    }
    const selection = await resolveUserChatSelection(args.db, {
        userId: args.userId,
        chatModel: access.chat.model,
        chatReasoningLevel: access.chat.reasoning_level,
    });
    if (!selection.ok) return { ok: false };

    const projectId = access.chat.project_id ?? null;
    let allowDocumentMutation = true;
    let canReadProjectMemory = false;
    let memorySharedAudience =
        !!access.chat.org_id ||
        access.chat.user_id !== args.userId ||
        (await hasDirectContentGrants(args.db, "chat", access.chat.id));
    if (projectId) {
        const projectAccess = await checkProjectAccess(
            projectId,
            args.userId,
            args.userEmail,
            args.db,
        );
        canReadProjectMemory = projectAccess.ok;
        allowDocumentMutation =
            projectAccess.ok && can(projectAccess.projectRole, "content.edit");
        if (projectAccess.ok) {
            memorySharedAudience =
                memorySharedAudience ||
                (await projectHasSharedAudience(
                    args.db,
                    projectId,
                    projectAccess.project.org_id,
                ));
        }
    }

    const rows = await getChatMessages(args.db, args.chatId);
    const messages = storedMessagesToChatMessages(rows);
    const { docIndex, docStore } = await buildDocContext(
        messages,
        args.userId,
        args.db,
        args.chatId,
    );
    const nonce = generateSpotlightNonce();
    const enriched = await enrichWithPriorEvents(
        messages,
        args.chatId,
        args.db,
        docIndex,
        nonce,
    );
    const settings = selection.modelSettings;
    const personalisationPrompt = buildUserPersonalisationPrompt(
        settings.personalisation,
        nonce,
    );
    const apiMessages = buildMessages(
        enriched,
        Object.entries(docIndex).map(([doc_id, info]) => ({
            doc_id,
            filename: info.filename,
        })),
        withAuExecutionBlocksPrompt(
            personalisationPrompt || undefined,
            settings.personalisation?.jurisdiction,
        ),
        undefined,
        {
            us: settings.legal_research_us,
            au: settings.legal_research_au,
            energy: settings.legal_research_au_energy,
            vic: settings.legal_research_au_vic,
            cases: settings.legal_research_au_cases,
        },
        nonce,
    );

    return {
        ok: true,
        apiMessages,
        docStore,
        docIndex,
        workflowStore: await buildWorkflowStore(
            args.userId,
            args.userEmail ?? undefined,
            args.db,
        ),
        ...(projectId ? { extraTools: PROJECT_EXTRA_TOOLS } : {}),
        allowDocumentMutation,
        legalResearchUs: settings.legal_research_us,
        legalResearchAu: settings.legal_research_au,
        legalResearchAuEnergy: settings.legal_research_au_energy,
        legalResearchAuVic: settings.legal_research_au_vic,
        legalResearchAuCases: settings.legal_research_au_cases,
        selectedModel: selection.selectedModel,
        selectedReasoningLevel: selection.selectedReasoningLevel,
        apiKeys: settings.api_keys,
        projectId,
        memoryProjectId: canReadProjectMemory ? projectId : null,
        memorySharedAudience,
        nonce,
    };
}
