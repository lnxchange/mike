import { captureInlineDocumentCleanup, completeInlineDocumentCleanup } from "./documents.cleanupJobs";
import type { Db } from "../../lib/supabase";
import {
  ok,
  internalFailure,
  type ServiceResult,
} from "../../lib/serviceResult";

type CollectionScope =
  | { kind: "project"; projectId: string }
  | {
      kind: "library";
      userId: string;
      libraryKind: "file" | "template";
      writableOrgIds?: string[];
    };

/**
 * Project callers authorize docs.organize and select ids within that project.
 * Library eligibility is rechecked here. The DELETE repeats the same scope;
 * the version trigger records cleanup within that transaction, including caches.
 */
export async function deleteCollectionDocuments(
  db: Db,
  scope: CollectionScope,
  documentIds: string[],
): Promise<ServiceResult<{ deletedIds: string[] }>> {
  if (!documentIds.length) return ok({ deletedIds: [] });
  let eligibleIds = documentIds;
  if (scope.kind === "library") {
    const applyKind = (query: ReturnType<Db["from"]>) =>
      scope.libraryKind === "file"
        ? query.or("library_kind.eq.file,library_kind.is.null")
        : query.eq("library_kind", scope.libraryKind);
    const personal = applyKind(
      db
        .from("documents")
        .select("id")
        .eq("user_id", scope.userId)
        .is("project_id", null)
        .is("org_id", null),
    ).in("id", documentIds);
    const orgIds = scope.writableOrgIds ?? [];
    const org =
      orgIds.length > 0
        ? applyKind(
            db
              .from("documents")
              .select("id")
              .is("project_id", null)
              .in("org_id", orgIds),
          ).in("id", documentIds)
        : Promise.resolve({ data: [], error: null });
    const [personalResult, orgResult] = await Promise.all([personal, org]);
    if (personalResult.error) return internalFailure(personalResult.error);
    if (orgResult.error) return internalFailure(orgResult.error);
    eligibleIds = [
      ...new Set(
        [...(personalResult.data ?? []), ...(orgResult.data ?? [])].map(
          (doc) => doc.id as string,
        ),
      ),
    ];
    if (!eligibleIds.length) return ok({ deletedIds: [] });
  }
  const keys = await captureInlineDocumentCleanup(db, { documentIds: eligibleIds });
  let query = db.from("documents").delete();
  if (scope.kind === "project") query = query.eq("project_id", scope.projectId);
  const { error } = await query.in("id", eligibleIds);
  if (error) return internalFailure(error);
  await completeInlineDocumentCleanup(db, keys);
  return ok({ deletedIds: eligibleIds });
}
