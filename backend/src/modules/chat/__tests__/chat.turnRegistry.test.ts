import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelRunningTurn,
  finishRunningTurn,
  getRunningTurn,
  recordTurnFrame,
  resetTurnRegistryForTests,
  startRunningTurn,
  subscribeToTurn,
  TURN_REPLAY_MAX_BYTES,
  TURN_RETENTION_MS,
} from "../chat.turnRegistry";

const base = {
  turnId: "turn-1",
  chatId: "chat-1",
  assistantMessageId: "asst-1",
  userId: "u1",
};

afterEach(() => {
  resetTurnRegistryForTests();
  vi.useRealTimers();
});

describe("turn registry", () => {
  it("records frames for replay and fans them out to subscribers", () => {
    const turn = startRunningTurn(base);
    recordTurnFrame(turn, "data: one\n\n");

    const seen: string[] = [];
    let ended = false;
    subscribeToTurn(turn, {
      onFrame: (line) => seen.push(line),
      onEnd: () => {
        ended = true;
      },
    });
    recordTurnFrame(turn, "data: two\n\n");
    finishRunningTurn(turn);

    expect(turn.frames).toEqual(["data: one\n\n", "data: two\n\n"]);
    expect(seen).toEqual(["data: two\n\n"]);
    expect(ended).toBe(true);
    expect(turn.finished).toBe(true);
  });

  it("cancels a turn running in this process and reports when it is not here", () => {
    const turn = startRunningTurn(base);
    expect(cancelRunningTurn("asst-1")).toBe(true);
    expect(turn.controller.signal.aborted).toBe(true);
    expect(cancelRunningTurn("asst-unknown")).toBe(false);
    finishRunningTurn(turn);
    expect(cancelRunningTurn("asst-1")).toBe(false);
  });

  it("keeps a finished turn addressable briefly, then forgets it", () => {
    vi.useFakeTimers();
    const turn = startRunningTurn(base);
    finishRunningTurn(turn);
    expect(getRunningTurn("asst-1")).toBe(turn);
    vi.advanceTimersByTime(TURN_RETENTION_MS + 1);
    expect(getRunningTurn("asst-1")).toBeUndefined();
  });

  it("stops buffering past the replay cap so a runaway turn cannot hold memory", () => {
    const turn = startRunningTurn(base);
    const chunk = "x".repeat(1024 * 1024);
    for (let i = 0; i < 9; i += 1) recordTurnFrame(turn, chunk);
    expect(turn.bytes).toBeGreaterThan(TURN_REPLAY_MAX_BYTES);
    expect(turn.overflowed).toBe(true);
    expect(turn.frames).toEqual([]);
  });

  it("replaces an earlier run when a continuation reuses the assistant row", () => {
    const first = startRunningTurn(base);
    recordTurnFrame(first, "data: old\n\n");
    finishRunningTurn(first);
    const second = startRunningTurn({ ...base, turnId: "turn-2" });
    expect(getRunningTurn("asst-1")).toBe(second);
    expect(second.frames).toEqual([]);
  });
});
