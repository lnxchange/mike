// Authorization for an upload session's destination.
//
// A manifest names where its files should land — a standalone document, a
// project folder, a library folder, a workflow asset, or a specific version
// of an existing document. This guard proves the caller may write there
// BEFORE any session row or signed URL exists, so an unauthorized manifest
// never reaches storage.
//
// Every rejection is a 404 unless the caller demonstrably knows the resource:
// a wrong-scope destination must not double as an existence oracle.

import {
  can,
  checkProjectAccess,
  checkWorkflowAccess,
  creatorScopedAllowed,
  ensureDocAccess,
} from "../../lib/access";
import {
  resolveLibraryActor,
  resolveLibraryWriteTarget,
} from "../library/library.service";
import type { Db } from "../../lib/supabase";
import type { ParsedUploadSessionRequest } from "./uploads.manifest";
import {
  failure,
  internalFailure,
  type UploadOutcome,
} from "./uploads.shared";

export async function validateDestinationAccess(
  manifest: ParsedUploadSessionRequest,
  userId: string,
  userEmail: string | undefined,
  db: Db,
): Promise<UploadOutcome> {
  const destination = manifest.destination as Record<string, unknown>;

  if (manifest.purpose === "document_create") {
    if (destination.scope === "standalone") return { ok: true };
    if (destination.scope === "workflow") {
      const workflowId = destination.workflow_id as string;
      const { data: workflow, error } = await db
        .from("workflows")
        .select("id, user_id, type")
        .eq("id", workflowId)
        .maybeSingle();
      if (error) return internalFailure(error);
      if (!workflow || workflow.type !== "assistant") {
        return failure(404, { detail: "Workflow not found or not editable" });
      }
      const workflowAccess = await checkWorkflowAccess(
        workflowId,
        userId,
        userEmail,
        db,
      );
      if (
        workflowAccess.ok &&
        can(workflowAccess.projectRole, "content.edit")
      )
        return { ok: true };
      return failure(404, { detail: "Workflow not found or not editable" });
    }
    if (destination.scope === "project") {
      const projectId = destination.project_id as string;
      const access = await checkProjectAccess(projectId, userId, userEmail, db);
      // Uploading into a project is content work: a viewer can open the
      // project but must not be able to open an upload session into it.
      if (!access.ok || !can(access.projectRole, "content.edit"))
        return failure(404, { detail: "Project not found" });
      const folderIds = Array.from(
        new Set(
          [
            destination.folder_id as string | null | undefined,
            ...manifest.files.map((file) => file.target_folder_id),
          ].filter((value): value is string => !!value),
        ),
      );
      if (folderIds.length) {
        const { data, error } = await db
          .from("project_subfolders")
          .select("id")
          .eq("project_id", projectId)
          .in("id", folderIds);
        if (error) return internalFailure(error);
        if ((data ?? []).length !== folderIds.length) {
          return failure(404, { detail: "Folder not found" });
        }
      }
      return { ok: true };
    }

    const actor = await resolveLibraryActor(db, userId);
    const libraryKind = destination.library_kind as "file" | "template";
    const folderIds = Array.from(
      new Set(
        [
          destination.folder_id as string | null | undefined,
          ...manifest.files.map((file) => file.target_folder_id),
        ].filter((value): value is string => !!value),
      ),
    );
    const primary = await resolveLibraryWriteTarget(db, actor, libraryKind, {
      folder_id: folderIds[0] ?? null,
      org_id: (destination.org_id as string | null | undefined) ?? null,
    });
    if (!primary.ok) {
      return primary.failure === "internal"
        ? internalFailure(primary.error)
        : failure(primary.status === 403 ? 403 : 404, { detail: primary.detail });
    }
    for (const folderId of folderIds.slice(1)) {
      const next = await resolveLibraryWriteTarget(db, actor, libraryKind, {
        folder_id: folderId,
        org_id: primary.data.orgId,
      });
      if (!next.ok) {
        return next.failure === "internal"
          ? internalFailure(next.error)
          : failure(next.status === 403 ? 403 : 404, { detail: next.detail });
      }
      if (next.data.orgId !== primary.data.orgId) {
        return failure(400, { detail: "Cannot upload into more than one library" });
      }
    }
    return { ok: true };
  }

  if (
    manifest.purpose === "document_version_create" ||
    manifest.purpose === "document_version_replace"
  ) {
    const documentId = destination.document_id as string;
    const { data: document, error } = await db
      .from("documents")
      .select("id, user_id, project_id, org_id, workflow_id")
      .eq("id", documentId)
      .maybeSingle();
    if (error) return internalFailure(error);
    if (!document) return failure(404, { detail: "Document not found" });
    const access = await ensureDocAccess(document, userId, userEmail, db);
    const canEditContent =
      access.ok && can(access.projectRole, "content.edit");
    // Replacing a version is creator-scoped (with the admin heir once the
    // creator's account is gone); workflow assets stay editable at the
    // workflow share's edit tier.
    const canReplace =
      access.ok &&
      (creatorScopedAllowed(access, document.user_id) ||
        (Boolean(document.workflow_id) && canEditContent));
    if (
      !access.ok ||
      !canEditContent ||
      (manifest.purpose === "document_version_replace" && !canReplace)
    ) {
      return failure(404, { detail: "Document not found" });
    }
    if (manifest.purpose === "document_version_create") return { ok: true };

    const { data: version, error: versionError } = await db
      .from("document_versions")
      .select("id, file_type, deleted_at")
      .eq("id", destination.version_id as string)
      .eq("document_id", documentId)
      .maybeSingle();
    if (versionError) return internalFailure(versionError);
    if (!version || version.deleted_at) {
      return failure(404, { detail: "Version not found" });
    }
    if (
      version.file_type &&
      version.file_type !== manifest.files[0].file_type
    ) {
      return failure(400, {
        detail: `Uploaded file type (${manifest.files[0].file_type}) does not match version type (${version.file_type}).`,
      });
    }
    return { ok: true };
  }

  const workflowId = destination.workflow_id as string;
  const { data: workflow, error } = await db
    .from("workflows")
    .select("id, user_id, type")
    .eq("id", workflowId)
    .maybeSingle();
  if (error) return internalFailure(error);
  if (!workflow) {
    return failure(404, { detail: "Workflow not found or not editable" });
  }

  const workflowAccess = await checkWorkflowAccess(
    workflowId,
    userId,
    userEmail,
    db,
  );
  const canEdit =
    workflowAccess.ok && can(workflowAccess.projectRole, "content.edit");
  if (!canEdit) {
    return failure(404, { detail: "Workflow not found or not editable" });
  }
  if (workflow.type === "tabular") {
    return failure(400, {
      detail: "Assets are only supported for assistant workflows",
    });
  }

  // Compatibility validation for in-flight sessions created by the previous
  // release. New clients use document_version_create.
  if (manifest.purpose === "workflow_reference_replace") {
    const { data: asset, error: assetError } = await db
      .from("documents")
      .select("id")
      .eq("id", destination.reference_id as string)
      .eq("workflow_id", workflowId)
      .maybeSingle();
    if (assetError) return internalFailure(assetError);
    if (!asset) return failure(404, { detail: "Asset not found" });
  }
  return { ok: true };
}
