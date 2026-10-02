import { type Response } from "express";

export type AssistantSse = {
  /** Aborted by the client hanging up, or by `abort()` when the route owns cancellation. */
  signal: AbortSignal;
  write: (line: string) => boolean;
  finish: () => void;
  /** True once the client has gone; writes are dropped from then on. */
  clientGone: () => boolean;
  /** Abort generation from the route (cancel endpoint, lease lost). */
  abort: (reason?: string) => void;
};

export function openAssistantSse(
  res: Response,
  options: {
    /**
     * Whether a closed socket aborts generation. Default true for surfaces
     * where the client is part of the loop (Word add-in). Chat passes false
     * so a turn keeps running and is persisted after the user navigates away.
     */
    abortOnClose?: boolean;
  } = {},
): AssistantSse {
  const abortOnClose = options.abortOnClose !== false;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const controller = new AbortController();
  let finished = false;
  let closed = false;
  res.on("close", () => {
    closed = true;
    if (!finished && abortOnClose) controller.abort();
  });

  return {
    signal: controller.signal,
    // A producer can lose the race against finish(): an error handler that
    // fires after the happy path already ended the response would call
    // res.write() on an ended stream, raising an asynchronous
    // ERR_STREAM_WRITE_AFTER_END that no try/catch around the write can see.
    // Dropping the late line is correct — the response is over either way.
    // A closed socket is dropped too: Node would only buffer those bytes.
    write: (line) => {
      if (finished || closed || res.writableEnded) return false;
      return res.write(line);
    },
    finish: () => {
      if (finished) return;
      finished = true;
      if (!closed) res.end();
    },
    clientGone: () => closed,
    abort: (reason) => {
      if (!controller.signal.aborted) controller.abort(reason);
    },
  };
}
