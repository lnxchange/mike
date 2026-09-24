// In-process record of the assistant turns this server is running.
//
// The socket that started a turn is only one viewer of it. Every SSE line
// the route writes is also recorded here, so a client that navigated away
// can reattach (replay, then tail) and the Stop button can abort a turn it
// no longer holds a connection to. The database lease (chat.turns.ts) is the
// cross-process truth; this registry is the fast path on the same instance.

export type TurnFrameListener = {
  onFrame: (line: string) => void;
  onEnd: () => void;
};

export type RunningTurn = {
  turnId: string;
  chatId: string;
  assistantMessageId: string;
  userId: string;
  startedAt: number;
  controller: AbortController;
  frames: string[];
  bytes: number;
  /** Buffering stopped because the turn grew past the replay cap. */
  overflowed: boolean;
  finished: boolean;
  finishedAt: number | null;
  listeners: Set<TurnFrameListener>;
};

/** Replay buffer cap per turn; past this, reattach falls back to polling. */
export const TURN_REPLAY_MAX_BYTES = 8 * 1024 * 1024;
/** How long a finished turn stays addressable for a late reattach. */
export const TURN_RETENTION_MS = 60_000;

const turns = new Map<string, RunningTurn>();
const retentionTimers = new Map<string, NodeJS.Timeout>();

export function startRunningTurn(args: {
  turnId: string;
  chatId: string;
  assistantMessageId: string;
  userId: string;
}): RunningTurn {
  const existing = turns.get(args.assistantMessageId);
  if (existing) {
    // An ask_inputs continuation reuses the assistant row; the earlier run
    // is over, so its buffer is replaced rather than appended to.
    clearRetention(args.assistantMessageId);
    turns.delete(args.assistantMessageId);
  }
  const turn: RunningTurn = {
    ...args,
    startedAt: Date.now(),
    controller: new AbortController(),
    frames: [],
    bytes: 0,
    overflowed: false,
    finished: false,
    finishedAt: null,
    listeners: new Set(),
  };
  turns.set(args.assistantMessageId, turn);
  return turn;
}

export function recordTurnFrame(turn: RunningTurn, line: string): void {
  if (!turn.overflowed) {
    turn.bytes += line.length;
    if (turn.bytes > TURN_REPLAY_MAX_BYTES) {
      turn.overflowed = true;
      turn.frames = [];
    } else {
      turn.frames.push(line);
    }
  }
  for (const listener of turn.listeners) {
    try {
      listener.onFrame(line);
    } catch {
      turn.listeners.delete(listener);
    }
  }
}

export function finishRunningTurn(turn: RunningTurn): void {
  if (turn.finished) return;
  turn.finished = true;
  turn.finishedAt = Date.now();
  for (const listener of turn.listeners) {
    try {
      listener.onEnd();
    } catch {
      /* listener already gone */
    }
  }
  turn.listeners.clear();
  clearRetention(turn.assistantMessageId);
  const timer = setTimeout(() => {
    if (turns.get(turn.assistantMessageId) === turn) {
      turns.delete(turn.assistantMessageId);
    }
    retentionTimers.delete(turn.assistantMessageId);
  }, TURN_RETENTION_MS);
  timer.unref?.();
  retentionTimers.set(turn.assistantMessageId, timer);
}

function clearRetention(assistantMessageId: string) {
  const timer = retentionTimers.get(assistantMessageId);
  if (timer) {
    clearTimeout(timer);
    retentionTimers.delete(assistantMessageId);
  }
}

export function getRunningTurn(
  assistantMessageId: string,
): RunningTurn | undefined {
  return turns.get(assistantMessageId);
}

/** Abort a turn running in this process. False when it is not here. */
export function cancelRunningTurn(assistantMessageId: string): boolean {
  const turn = turns.get(assistantMessageId);
  if (!turn || turn.finished) return false;
  turn.controller.abort("cancelled");
  return true;
}

export function subscribeToTurn(
  turn: RunningTurn,
  listener: TurnFrameListener,
): () => void {
  turn.listeners.add(listener);
  return () => {
    turn.listeners.delete(listener);
  };
}

/** Test hook. */
export function resetTurnRegistryForTests(): void {
  for (const timer of retentionTimers.values()) clearTimeout(timer);
  retentionTimers.clear();
  turns.clear();
}
