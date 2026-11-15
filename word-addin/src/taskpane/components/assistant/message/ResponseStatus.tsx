import { LibrisMark } from "../../shell/LibrisMark";

export type StatusState = "active" | "error" | null;

/**
 * The Libris mark spins while a response is active.
 */
export function ResponseStatus({
  status,
}: {
  status: StatusState;
}): React.ReactElement {
  return (
    <div
      data-testid="assistant-response-status"
      className="mb-2 flex h-9 w-full items-center"
    >
      <LibrisMark size={22} spin={status === "active"} />
    </div>
  );
}
