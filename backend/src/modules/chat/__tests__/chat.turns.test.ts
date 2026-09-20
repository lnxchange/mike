import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeTurnFromChatRow,
  claimChatTurn,
  heartbeatChatTurn,
  releaseChatTurn,
  requestChatTurnCancel,
  startChatTurnHeartbeat,
  withRunningTurnMessage,
  CHAT_TURN_STALE_AFTER_SECONDS,
} from "../chat.turns";

afterEach(() => {
  vi.useRealTimers();
});

function dbWithRpc(
  impl: (name: string, args: Record<string, unknown>) => unknown,
) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const value = impl(name, args);
    return value instanceof Error
      ? { data: null, error: { message: value.message, code: "XX000" } }
      : { data: value, error: null };
  });
  return { db: { rpc } as never, rpc };
}

describe("claimChatTurn", () => {
  it("returns the lease when the database claims the chat", async () => {
    const { db, rpc } = dbWithRpc(() => [{ claimed: true }]);
    const result = await claimChatTurn(db, {
      chatId: "chat-1",
      assistantMessageId: "asst-1",
      turnId: "turn-1",
    });
    expect(result).toEqual({
      ok: true,
      lease: { chatId: "chat-1", turnId: "turn-1", assistantMessageId: "asst-1" },
    });
    expect(rpc).toHaveBeenCalledWith("claim_chat_turn", {
      p_chat_id: "chat-1",
      p_turn_id: "turn-1",
      p_assistant_message_id: "asst-1",
      p_stale_after_seconds: CHAT_TURN_STALE_AFTER_SECONDS,
    });
  });

  it("reports the running turn when another claim holds the chat", async () => {
    const { db } = dbWithRpc(() => [
      {
        claimed: false,
        active_turn_id: "turn-0",
        active_turn_message_id: "asst-0",
        active_turn_started_at: "2026-09-20T07:08:49.000Z",
      },
    ]);
    const result = await claimChatTurn(db, {
      chatId: "chat-1",
      assistantMessageId: "asst-1",
    });
    expect(result).toEqual({
      ok: false,
      active: {
        turnId: "turn-0",
        assistantMessageId: "asst-0",
        startedAt: "2026-09-20T07:08:49.000Z",
      },
    });
  });

  it("fails open when the lease RPC is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = dbWithRpc(() => new Error("function does not exist"));
    const result = await claimChatTurn(db, {
      chatId: "chat-1",
      assistantMessageId: "asst-1",
    });
    expect(result.ok).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("heartbeat, release, cancel", () => {
  it("maps the heartbeat row", async () => {
    const { db } = dbWithRpc(() => [{ alive: true, cancel_requested: true }]);
    expect(
      await heartbeatChatTurn(db, {
        chatId: "chat-1",
        turnId: "turn-1",
        assistantMessageId: "asst-1",
      }),
    ).toEqual({ alive: true, cancelRequested: true });
  });

  it("treats a heartbeat failure as still alive and not cancelled", async () => {
    const { db } = dbWithRpc(() => new Error("down"));
    expect(
      await heartbeatChatTurn(db, {
        chatId: "chat-1",
        turnId: "turn-1",
        assistantMessageId: "asst-1",
      }),
    ).toEqual({ alive: true, cancelRequested: false });
  });

  it("releases by turn id", async () => {
    const { db, rpc } = dbWithRpc(() => true);
    await releaseChatTurn(db, {
      chatId: "chat-1",
      turnId: "turn-1",
      assistantMessageId: "asst-1",
    });
    expect(rpc).toHaveBeenCalledWith("release_chat_turn", {
      p_chat_id: "chat-1",
      p_turn_id: "turn-1",
    });
  });

  it("returns the turn id a cancel was recorded against", async () => {
    const { db } = dbWithRpc(() => [{ requested: true, turn_id: "turn-1" }]);
    expect(
      await requestChatTurnCancel(db, {
        chatId: "chat-1",
        assistantMessageId: "asst-1",
      }),
    ).toEqual({ requested: true, turnId: "turn-1" });
  });
});

describe("startChatTurnHeartbeat", () => {
  const lease = { chatId: "chat-1", turnId: "turn-1", assistantMessageId: "asst-1" };

  it("aborts the turn when a cancel was requested elsewhere", async () => {
    vi.useFakeTimers();
    const { db, rpc } = dbWithRpc(() => [{ alive: true, cancel_requested: true }]);
    const controller = new AbortController();
    const stop = startChatTurnHeartbeat(db, lease, controller, 1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(rpc).toHaveBeenCalledWith("heartbeat_chat_turn", {
      p_chat_id: "chat-1",
      p_turn_id: "turn-1",
    });
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("cancelled");
    stop();
  });

  it("aborts with lease_lost when another turn has taken the chat", async () => {
    vi.useFakeTimers();
    const { db } = dbWithRpc(() => [{ alive: false, cancel_requested: false }]);
    const controller = new AbortController();
    const stop = startChatTurnHeartbeat(db, lease, controller, 1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(controller.signal.reason).toBe("lease_lost");
    stop();
  });

  it("keeps beating while the turn is healthy and stops on request", async () => {
    vi.useFakeTimers();
    const { db, rpc } = dbWithRpc(() => [{ alive: true, cancel_requested: false }]);
    const controller = new AbortController();
    const stop = startChatTurnHeartbeat(db, lease, controller, 1000);

    await vi.advanceTimersByTimeAsync(3000);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(controller.signal.aborted).toBe(false);

    stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});

describe("withRunningTurnMessage", () => {
  it("appends one running assistant row while a fresh lease points at it", () => {
    const now = new Date().toISOString();
    const messages = [{ id: "u-1", role: "user" }];
    const result = withRunningTurnMessage(messages, {
      id: "chat-1",
      active_turn_id: "turn-1",
      active_turn_message_id: "asst-1",
      active_turn_started_at: now,
      active_turn_heartbeat_at: now,
    });
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      id: "asst-1",
      chat_id: "chat-1",
      role: "assistant",
      content: null,
      status: "running",
      started_at: now,
    });
  });

  it("leaves the transcript alone when nothing is running or the row is already present", () => {
    const messages = [{ id: "asst-1", role: "assistant" }];
    expect(withRunningTurnMessage(messages, { id: "chat-1" })).toBe(messages);
    const now = new Date().toISOString();
    expect(
      withRunningTurnMessage(messages, {
        id: "chat-1",
        active_turn_id: "turn-1",
        active_turn_message_id: "asst-1",
        active_turn_started_at: now,
        active_turn_heartbeat_at: now,
      }),
    ).toBe(messages);
  });
});

describe("activeTurnFromChatRow", () => {
  it("returns null when no turn is running", () => {
    expect(activeTurnFromChatRow({ active_turn_id: null })).toBeNull();
  });

  it("returns the live turn while the heartbeat is fresh", () => {
    const now = new Date().toISOString();
    expect(
      activeTurnFromChatRow({
        active_turn_id: "turn-1",
        active_turn_message_id: "asst-1",
        active_turn_started_at: now,
        active_turn_heartbeat_at: now,
      }),
    ).toEqual({ turnId: "turn-1", assistantMessageId: "asst-1", startedAt: now });
  });

  it("hides a turn whose heartbeat has gone stale", () => {
    const old = new Date(
      Date.now() - (CHAT_TURN_STALE_AFTER_SECONDS + 30) * 1000,
    ).toISOString();
    expect(
      activeTurnFromChatRow({
        active_turn_id: "turn-1",
        active_turn_message_id: "asst-1",
        active_turn_started_at: old,
        active_turn_heartbeat_at: old,
      }),
    ).toBeNull();
  });
});
