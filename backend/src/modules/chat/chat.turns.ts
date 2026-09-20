// One assistant turn at a time per chat.
//
// The lease lives on the chats row (claim_chat_turn / heartbeat_chat_turn /
// release_chat_turn / request_chat_turn_cancel). A second stream request
// while a turn holds the lease is answered 409 so it cannot cancel the
// running turn or run blind to its edits. The heartbeat keeps the lease
// honest across a crashed process: a stale heartbeat lets the next request
// reclaim the chat.

import { randomUUID } from "node:crypto";
import type { Db } from "../../lib/supabase";

/** How long a lease survives without a heartbeat before it can be reclaimed. */
export const CHAT_TURN_STALE_AFTER_SECONDS = 90;
/** Heartbeat cadence while a turn runs; also the cancel poll interval. */
export const CHAT_TURN_HEARTBEAT_MS = 5_000;

export type ChatTurnLease = {
  chatId: string;
  turnId: string;
  assistantMessageId: string;
};

export type ActiveChatTurn = {
  turnId: string;
  assistantMessageId: string | null;
  startedAt: string | null;
};

export type ClaimChatTurnResult =
  | { ok: true; lease: ChatTurnLease }
  | { ok: false; active: ActiveChatTurn };

type ClaimRow = {
  claimed: boolean;
  active_turn_id: string | null;
  active_turn_message_id: string | null;
  active_turn_started_at: string | null;
};

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  if (data && typeof data === "object") return data as T;
  return null;
}

/**
 * Claim the chat for a new turn. A database failure fails open with a
 * warning: a missing migration must not take chat down, and the worst case
 * is the pre-lease behaviour.
 */
export async function claimChatTurn(
  db: Db,
  args: { chatId: string; assistantMessageId: string; turnId?: string },
): Promise<ClaimChatTurnResult> {
  const turnId = args.turnId ?? randomUUID();
  const lease: ChatTurnLease = {
    chatId: args.chatId,
    turnId,
    assistantMessageId: args.assistantMessageId,
  };
  const { data, error } = await db.rpc("claim_chat_turn", {
    p_chat_id: args.chatId,
    p_turn_id: turnId,
    p_assistant_message_id: args.assistantMessageId,
    p_stale_after_seconds: CHAT_TURN_STALE_AFTER_SECONDS,
  });
  if (error) {
    console.warn("[chat/turn] lease claim failed; continuing without lease", {
      chatId: args.chatId,
      code: (error as { code?: string }).code,
    });
    return { ok: true, lease };
  }
  const row = firstRow<ClaimRow>(data);
  if (!row || row.claimed) return { ok: true, lease };
  return {
    ok: false,
    active: {
      turnId: row.active_turn_id ?? "",
      assistantMessageId: row.active_turn_message_id,
      startedAt: row.active_turn_started_at,
    },
  };
}

/**
 * Undo the user row a request inserted before it learned the chat was busy,
 * so a refused turn does not leave a question with no reply in the history.
 */
export async function discardChatInputMessage(
  db: Db,
  args: { chatId: string; inputMessageId: string | null },
): Promise<void> {
  if (!args.inputMessageId) return;
  const { error } = await db
    .from("chat_messages")
    .delete()
    .eq("id", args.inputMessageId)
    .eq("chat_id", args.chatId);
  if (error) {
    console.warn("[chat/turn] could not discard refused input message", {
      chatId: args.chatId,
    });
  }
}

export async function releaseChatTurn(
  db: Db,
  lease: ChatTurnLease,
): Promise<void> {
  const { error } = await db.rpc("release_chat_turn", {
    p_chat_id: lease.chatId,
    p_turn_id: lease.turnId,
  });
  if (error) {
    console.warn("[chat/turn] lease release failed", {
      chatId: lease.chatId,
      code: (error as { code?: string }).code,
    });
  }
}

export type ChatTurnHeartbeat = { alive: boolean; cancelRequested: boolean };

export async function heartbeatChatTurn(
  db: Db,
  lease: ChatTurnLease,
): Promise<ChatTurnHeartbeat> {
  const { data, error } = await db.rpc("heartbeat_chat_turn", {
    p_chat_id: lease.chatId,
    p_turn_id: lease.turnId,
  });
  if (error) return { alive: true, cancelRequested: false };
  const row = firstRow<{ alive: boolean; cancel_requested: boolean }>(data);
  if (!row) return { alive: true, cancelRequested: false };
  return { alive: row.alive, cancelRequested: row.cancel_requested };
}

export async function requestChatTurnCancel(
  db: Db,
  args: { chatId: string; assistantMessageId: string },
): Promise<{ requested: boolean; turnId: string | null }> {
  const { data, error } = await db.rpc("request_chat_turn_cancel", {
    p_chat_id: args.chatId,
    p_assistant_message_id: args.assistantMessageId,
  });
  if (error) return { requested: false, turnId: null };
  const row = firstRow<{ requested: boolean; turn_id: string | null }>(data);
  return { requested: row?.requested ?? false, turnId: row?.turn_id ?? null };
}

/** The lease as a client sees it, or null when nothing is running. */
export function activeTurnFromChatRow(row: {
  active_turn_id?: string | null;
  active_turn_message_id?: string | null;
  active_turn_started_at?: string | null;
  active_turn_heartbeat_at?: string | null;
}): ActiveChatTurn | null {
  if (!row.active_turn_id) return null;
  const heartbeat = row.active_turn_heartbeat_at ?? row.active_turn_started_at;
  if (heartbeat) {
    const age = Date.now() - new Date(heartbeat).getTime();
    if (Number.isFinite(age) && age > CHAT_TURN_STALE_AFTER_SECONDS * 1000) {
      return null;
    }
  }
  return {
    turnId: row.active_turn_id,
    assistantMessageId: row.active_turn_message_id ?? null,
    startedAt: row.active_turn_started_at ?? null,
  };
}
