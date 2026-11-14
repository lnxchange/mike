/**
 * Files chosen in the New Project dialog, waiting for the project page to
 * upload them.
 *
 * Creating a project used to block the dialog until every attached file had
 * finished server-side conversion, which for a hundred documents was minutes
 * of "Creating…". Instead the dialog stashes the File objects here, finishes
 * immediately, and the project's document table takes them on mount and runs
 * them through its ordinary upload flow (progress rows, per-file failures,
 * documents appearing as they become ready).
 *
 * Module state is fine here: File objects survive a client-side navigation,
 * and a full page load (which would lose them) also loses the dialog that
 * chose them, so there is nothing to recover.
 */
const pendingByProject = new Map<string, File[]>();

export function stashPendingProjectUploads(projectId: string, files: File[]) {
    if (files.length === 0) return;
    const existing = pendingByProject.get(projectId) ?? [];
    pendingByProject.set(projectId, [...existing, ...files]);
}

/** Returns and clears the pending files for a project. */
export function takePendingProjectUploads(projectId: string): File[] {
    const files = pendingByProject.get(projectId) ?? [];
    pendingByProject.delete(projectId);
    return files;
}

export function hasPendingProjectUploads(projectId: string): boolean {
    return (pendingByProject.get(projectId)?.length ?? 0) > 0;
}
