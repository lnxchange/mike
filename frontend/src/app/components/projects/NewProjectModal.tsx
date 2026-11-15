"use client";

import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import {
    addDocumentToProject,
    createProject,
    grantProjectAccess,
    setProjectMemoryEnabled,
    updateProject,
} from "@/app/lib/mikeApi";
import {
    hasPendingProjectUploads,
    stashPendingProjectUploads,
} from "@/app/lib/pendingProjectUploads";
import { FileDirectory } from "../shared/FileDirectory";
import type { ContentVisibility, Document, Project } from "../shared/types";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { Modal } from "../modals/Modal";
import { FieldLabel, FormTextInput } from "../ui/form-field";
import { ToggleSwitchUI } from "@mike/ui";
import { ProjectPracticeField } from "./ProjectPracticeField";
import { userFacingApiError } from "@/app/lib/userFacingError";
import {
    PERSONAL_WORKSPACE as ACTIVE_PERSONAL_WORKSPACE,
    useWorkspace,
} from "@/app/contexts/WorkspaceContext";
import {
    CreateAccessStep,
    type PendingDirectGrant,
    type PendingOrgOverride,
} from "../modals/CreateAccessStep";
import { WarningPopup } from "../popups/WarningPopup";
import { appConfig } from "@/config";
import {
    SUPPORTED_DOCUMENT_ACCEPT,
    formatUnsupportedDocumentWarning,
    partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";
import { AccessVisibilityField } from "../modals/AccessVisibilityField";
import { settleBulkRequests } from "@/app/lib/bulkRequests";

const PERSONAL_WORKSPACE = "__personal__";
const t = appConfig.terminology;

interface Props {
    open: boolean;
    /**
     * Dismissal. `createdWithoutHandover` is true when the project exists but
     * a later step failed, so it never reached `onCreated` — the caller has to
     * refetch or the new project stays invisible until a reload.
     */
    onClose: (createdWithoutHandover?: boolean) => void;
    onCreated: (project: Project) => void;
}

/** Collects project details, pending access choices, and documents before creating the project. */
export function NewProjectModal({ open, onClose, onCreated }: Props) {
    const [step, setStep] = useState<"details" | "access" | "documents">(
        "details",
    );
    const [name, setName] = useState("");
    const [cmNumber, setCmNumber] = useState("");
    const [practice, setPractice] = useState("");
    const [sharedUsers, setSharedUsers] = useState<PendingDirectGrant[]>([]);
    const [orgOverrides, setOrgOverrides] = useState<PendingOrgOverride[]>([]);
    // A new project is created in the workspace the person is working in:
    // an organization's, or their own. There is no choosing another one here,
    // because a project made elsewhere would not appear in the list this
    // modal was opened from, and work cannot be shared across organizations.
    const { workspaceId: activeWorkspaceId, activeOrganization } =
        useWorkspace();
    const orgId =
        activeWorkspaceId && activeWorkspaceId !== ACTIVE_PERSONAL_WORKSPACE
            ? activeWorkspaceId
            : PERSONAL_WORKSPACE;
    const organizationName = activeOrganization?.name ?? null;
    // Inside an organization a project is private — shared with individuals
    // — unless its creator makes it public on the details step.
    const [visibility, setVisibility] = useState<ContentVisibility>("private");
    const [memoryEnabled, setMemoryEnabled] = useState(true);
    const memoryEditedRef = useRef(false);
    const [selectedDocuments, setSelectedDocuments] = useState<Document[]>([]);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [unsupportedWarning, setUnsupportedWarning] = useState<string | null>(
        null,
    );
    // A project created with only some of its files attached. The modal holds
    // it until the user has read which files are missing.
    const [pendingProject, setPendingProject] = useState<Project | null>(null);
    // Mirrors `createdProjectRef` for rendering: a ref does not re-render, and
    // the wizard has to change shape the moment the project is real. Back
    // still works — a failed grant or attachment is retried from the step it
    // failed on — but the fields that identify the project (name, CM number,
    // practice, workspace) lock, because a retry reuses the project already
    // created and would ignore any edit made to them.
    const [projectExists, setProjectExists] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const practiceEditedRef = useRef(false);
    // The project is created before its grants are written and its documents
    // are attached. Remember it so a retry after either kind of failure
    // reuses the project the user already has instead of creating a second
    // one.
    const createdProjectRef = useRef<Project | null>(null);
    // Documents already linked against that project. A retry after a failed
    // step must not re-link a document that landed on the first attempt.
    const linkedDocumentIdsRef = useRef<Set<string>>(new Set());
    const { user } = useAuth();
    const { profile } = useUserProfile();
    const preferredPractice =
        profile?.practiceAreas.find((area) => area.trim())?.trim() ?? "";
    const projectMemoryDefault = profile?.projectMemoryDefault !== false;
    const ownEmail = user?.email?.trim().toLowerCase() ?? null;
    const formId = "new-project-modal-form";

    useEffect(() => {
        if (!open) {
            practiceEditedRef.current = false;
            return;
        }
        if (!preferredPractice || practiceEditedRef.current) return;
        setPractice(preferredPractice);
    }, [open, preferredPractice]);

    // The account's saved default seeds this project's memory setting, until
    // the creator says otherwise for this one project.
    useEffect(() => {
        if (!open) {
            memoryEditedRef.current = false;
            return;
        }
        if (memoryEditedRef.current) return;
        setMemoryEnabled(projectMemoryDefault);
    }, [open, projectMemoryDefault]);

    if (!open) return null;

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (!files.length) return;
        const { supported, unsupported } = partitionSupportedDocumentFiles(files);
        setUnsupportedWarning(formatUnsupportedDocumentWarning(unsupported));
        if (!supported.length) return;
        // Deduplicated by identity, not by name. The old name test silently
        // dropped the second of two files called `contract.pdf`.
        setPendingFiles((prev) => [
            ...prev,
            ...supported.filter((file) => !prev.includes(file)),
        ]);
    }

    function finishCreation(project: Project) {
        onCreated(project);
        resetForm();
        onClose();
    }

    function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!name.trim()) return;
        if (step === "details") {
            setStep("access");
            return;
        }
        if (step === "access") {
            setStep("documents");
        }
    }

    async function createProjectFromDocuments() {
        if (!name.trim() || loading || step !== "documents") return;
        setLoading(true);
        setError("");
        try {
            if (pendingProject) {
                let project = pendingProject;
                if (project.memory_enabled !== memoryEnabled) {
                    await setProjectMemoryEnabled(project.id, memoryEnabled);
                    project = { ...project, memory_enabled: memoryEnabled };
                }
                finishCreation(project);
                return;
            }
            // Create, then grant each recipient through the role-aware access
            // endpoint, which also supports recipients without an account.
            let project = createdProjectRef.current;
            const retrying = !!project;
            if (!project) {
                const trimmedPractice =
                    practice.trim() && practice.trim() !== "Other"
                        ? practice.trim()
                        : undefined;
                // Visibility is an organization's setting; a personal
                // project is sent without one, as it always was.
                project =
                    orgId !== PERSONAL_WORKSPACE
                        ? await createProject(
                              name.trim(),
                              cmNumber.trim() || undefined,
                              trimmedPractice,
                              orgId,
                              memoryEnabled,
                              visibility,
                          )
                        : await createProject(
                              name.trim(),
                              cmNumber.trim() || undefined,
                              trimmedPractice,
                              undefined,
                              memoryEnabled,
                          );
            } else if (project.memory_enabled !== memoryEnabled) {
                // A failed grant or attachment leaves the newly created
                // project available for retry. If the user goes Back and
                // changes the memory choice, persist that choice before
                // retrying anything else; changing only the optimistic row
                // would violate an explicit opt-out.
                await setProjectMemoryEnabled(project.id, memoryEnabled);
                project = { ...project, memory_enabled: memoryEnabled };
            }
            // Same for who can open it: a retry after going Back must
            // apply the choice now on screen, not the one the project was
            // first created with. A project created just above already has
            // it, and is only stamped so a later retry can compare.
            if (orgId !== PERSONAL_WORKSPACE) {
                if (
                    retrying &&
                    (project.visibility ?? "private") !== visibility
                )
                    await updateProject(project.id, { visibility });
                project = { ...project, visibility };
            }
            createdProjectRef.current = project;
            setProjectExists(true);

            // Grants run before the attachment work: a refusal here stops the
            // submit, and anything already uploaded or linked would otherwise
            // have to be redone on the retry — which duplicated documents.
            //
            // Sequential: these are a handful of addresses, and one refusal
            // should be reported with its own message rather than lost in a
            // race. The endpoint upserts, so a retry after a partial failure
            // is safe.
            const recipients = (
                orgId === PERSONAL_WORKSPACE ? sharedUsers : orgOverrides
            ).filter((entry) => !ownEmail || entry.email !== ownEmail);
            const grantFailures: { email: string; detail: string }[] = [];
            for (const entry of recipients) {
                try {
                    await grantProjectAccess(
                        project.id,
                        entry.email,
                        entry.role,
                    );
                } catch (err: unknown) {
                    grantFailures.push({
                        email: entry.email,
                        detail: userFacingApiError(err, "the request failed"),
                    });
                }
            }
            if (grantFailures.length > 0) {
                // The project exists, so say so — and stay open rather than
                // navigating away from the only place that knows the sharing
                // did not happen. Pressing Create again retries the grants
                // against the same project.
                // Say what happened to the documents too. The submit stops
                // here, so nothing the user attached has been sent yet — and
                // an error that mentions only the sharing reads as though the
                // files went in, which is the opposite of the truth.
                const stillPending =
                    selectedDocuments.filter(
                        (document) =>
                            !linkedDocumentIdsRef.current.has(document.id),
                    ).length + pendingFiles.length;
                setError(
                    `${t.project} created, but access was not granted to ${grantFailures
                        .map((failure) => failure.email)
                        .join(", ")}: ${grantFailures[0].detail}${
                        stillPending > 0
                            ? ` The ${stillPending} selected ${
                                  stillPending === 1 ? "file is" : "files are"
                              } still pending and will be attached when you try again.`
                            : ""
                    }`,
                );
                // Stay open on THIS dialog: createdProjectRef holds the
                // project, so pressing Create again retries only the grants.
                return;
            }

            // Only documents this modal has not already linked: a retry after
            // a later failure must not add the same document twice.
            const documentsToLink = selectedDocuments.filter(
                (document) => !linkedDocumentIdsRef.current.has(document.id),
            );
            const links = await settleBulkRequests(documentsToLink, (document) =>
                addDocumentToProject(project.id, document.id),
            );
            links.succeeded.forEach((document) =>
                linkedDocumentIdsRef.current.add(document.id),
            );
            const failedLinkNames = links.failed.map(
                (document) => document.filename,
            );

            // Chosen files are not uploaded from here. Converting a large
            // batch can take minutes, so the project page takes them over
            // and uploads them with its own progress rows. A retry must not
            // stash the same File objects twice.
            if (
                pendingFiles.length > 0 &&
                !hasPendingProjectUploads(project.id)
            ) {
                stashPendingProjectUploads(project.id, pendingFiles);
            }

            // Counted across attempts, not just this one, so a retry reports
            // the project's real document count. Stashed files are the
            // project page's job and are not part of this count.
            const attachedCount = linkedDocumentIdsRef.current.size;
            const requestedCount = selectedDocuments.length;
            const failureMessage =
                failedLinkNames.length > 0
                    ? `${failedLinkNames.join(", ")} could not be added to the ${t.projectLower}.`
                    : "";

            // POST /projects returns a bare row with no role fields, and
            // the list's fail-closed roleFrom() reads "no role fields" as
            // viewer — so the creator had no row menu, no Edit details and no
            // Delete on the project they just made until a refetch. This
            // row's standing is not unknown: the caller IS the creator, and a
            // creator derives Owner by definition. The same stamp the optimistic
            // chat row gets in ChatHistoryContext, for the same reason.
            const stamped = {
                ...project,
                is_owner: true,
                access_role: "owner" as const,
                // Belonging to an organization is not being shared with it:
                // the label follows what was actually chosen.
                access_scope:
                    orgId !== PERSONAL_WORKSPACE && visibility === "organization"
                        ? ("organization" as const)
                        : recipients.some((entry) => entry.role !== "deny")
                          ? ("shared" as const)
                          : ("private" as const),
                organization_name: organizationName,
                memory_enabled: memoryEnabled,
                ...(orgId === PERSONAL_WORKSPACE && recipients.length > 0
                    ? { direct_grant_count: recipients.length }
                    : {}),
            };

            if (failureMessage) {
                setError(failureMessage);
                // Nothing the user attached made it in: stay put so the primary
                // action retries the attachments against the same project,
                // instead of closing on a project with no documents.
                if (attachedCount === 0 && requestedCount > 0) return;
                // Partial success: the project is real, so let the user read
                // which files are missing before the modal hands it over.
                setPendingProject({
                    ...stamped,
                    document_count: attachedCount,
                });
                return;
            }

            finishCreation({ ...stamped, document_count: attachedCount });
        } catch (err: unknown) {
            setError(
                userFacingApiError(err, `Failed to create ${t.projectLower}`),
            );
        } finally {
            setLoading(false);
        }
    }

    function resetForm() {
        createdProjectRef.current = null;
        setProjectExists(false);
        linkedDocumentIdsRef.current = new Set();
        setPendingProject(null);
        setStep("details");
        setName("");
        setCmNumber("");
        setPractice("");
        practiceEditedRef.current = false;
        setSharedUsers([]);
        setOrgOverrides([]);
        setSelectedDocuments([]);
        setPendingFiles([]);
        setVisibility("private");
        setMemoryEnabled(projectMemoryDefault);
        setError("");
        setUnsupportedWarning(null);
    }

    function handleClose() {
        // Escape and the backdrop reach this too: dismissing a create that is
        // still in flight would leave the outcome unreportable.
        if (loading) return;
        // The project exists but never reached onCreated, so the caller's list
        // does not have it. Say so on the way out instead of leaving the row
        // invisible until a reload.
        const createdWithoutHandover = createdProjectRef.current !== null;
        resetForm();
        onClose(createdWithoutHandover);
    }

    return (
        <Modal
            open={open}
            onClose={handleClose}
            breadcrumbs={[
                t.projects,
                `New ${t.projectLower}`,
                step === "details"
                    ? "Details"
                    : step === "access"
                      ? orgId === PERSONAL_WORKSPACE
                          ? "Access"
                          : "People"
                      : "Add Documents",
            ]}
            secondaryAction={
                step === "documents"
                    ? {
                          label: `Upload${pendingFiles.length > 0 ? ` (${pendingFiles.length})` : ""}`,
                          icon: <Upload className="h-3.5 w-3.5" />,
                          onClick: () => fileInputRef.current?.click(),
                          disabled: loading,
                      }
                    : step === "access"
                      ? {
                            label: "Back",
                            type: "button",
                            onClick: () => setStep("details"),
                            disabled: loading,
                        }
                      : undefined
            }
            cancelAction={
                step === "documents"
                    ? {
                          label: "Back",
                          onClick: () => setStep("access"),
                          // Back stays open once the project exists: a retry
                          // persists a changed memory choice before anything
                          // else, so the details step still describes
                          // something that can change. The one field it no
                          // longer describes is the workspace, which is locked
                          // below rather than retiring the whole step.
                          disabled: loading,
                      }
                    : step === "access"
                      ? {
                            label: "Skip",
                            type: "button",
                            onClick: () => {
                                setSharedUsers([]);
                                setOrgOverrides([]);
                                setStep("documents");
                            },
                            disabled: loading,
                        }
                      : undefined
            }
            primaryAction={
                step === "details"
                    ? {
                          label: "Next",
                          type: "button",
                          onClick: () => setStep("access"),
                          disabled: !name.trim() || loading,
                      }
                    : step === "access"
                      ? {
                            label: "Next",
                            type: "button",
                            onClick: () => setStep("documents"),
                            disabled: loading,
                        }
                      : {
                            label: loading
                                ? "Creating…"
                                : pendingProject
                                  ? "Continue"
                                  : `Create ${t.projectLower}`,
                            type: "button",
                            onClick: () => void createProjectFromDocuments(),
                            disabled: !name.trim() || loading,
                        }
            }
        >
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={SUPPORTED_DOCUMENT_ACCEPT}
                className="hidden"
                onChange={handleFileChange}
            />
            <form
                id={formId}
                onSubmit={handleSubmit}
                className="flex flex-col flex-1 min-h-0"
            >
                {step === "details" ? (
                    <div className="space-y-6">
                        <div>
                            <FieldLabel htmlFor="new-project-name">
                                {t.project} name
                            </FieldLabel>
                            <FormTextInput
                                id="new-project-name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={`Add ${t.projectLower} name`}
                                variant="minimal"
                                // Once the project EXISTS the retry reuses
                                // `createdProjectRef` and never reads these
                                // fields again, so an edit made here on the
                                // second attempt was silently discarded. The
                                // fields that identify the project lock with
                                // the workspace selector below.
                                disabled={projectExists}
                                autoFocus
                            />
                        </div>

                        <div>
                            <FieldLabel htmlFor="new-project-cm-number">
                                {t.referenceNumber}
                            </FieldLabel>
                            <FormTextInput
                                id="new-project-cm-number"
                                type="text"
                                value={cmNumber}
                                onChange={(e) => setCmNumber(e.target.value)}
                                placeholder={`Add a ${t.referenceNumber}...`}
                                variant="minimal"
                                className="text-xl text-gray-600"
                                disabled={projectExists}
                            />
                        </div>

                        <div>
                            <FieldLabel htmlFor="new-project-practice">
                                Practice
                            </FieldLabel>
                            <ProjectPracticeField
                                id="new-project-practice"
                                value={practice}
                                onChange={(value) => {
                                    practiceEditedRef.current = true;
                                    setPractice(value);
                                }}
                                disabled={projectExists}
                            />
                        </div>

                        {orgId !== PERSONAL_WORKSPACE ? (
                            <AccessVisibilityField
                                visibility={visibility}
                                onChange={(next) => {
                                    setVisibility(next);
                                    // What was lined up for the other
                                    // setting does not carry over: named
                                    // people belong to a private project,
                                    // and denials to a public one.
                                    setOrgOverrides([]);
                                }}
                                organizationName={organizationName}
                                resourceNoun="project"
                                disabled={loading}
                            />
                        ) : null}
                        {projectExists && (
                            <p className="text-sm text-gray-500">
                                The project has been created, so its name, CM
                                number and practice can no longer be changed
                                here. Edit them from the project once this
                                finishes.
                            </p>
                        )}

                        <div>
                            <FieldLabel as="p">{t.project} memory</FieldLabel>
                            <ToggleSwitchUI
                                checked={memoryEnabled}
                                onCheckedChange={(enabled) => {
                                    memoryEditedRef.current = true;
                                    setMemoryEnabled(enabled);
                                }}
                                aria-label={`Enable ${t.projectLower} memory`}
                            >
                                {memoryEnabled ? "On" : "Off"}
                            </ToggleSwitchUI>
                        </div>
                    </div>
                ) : step === "access" ? (
                    <CreateAccessStep
                        orgId={orgId === PERSONAL_WORKSPACE ? null : orgId}
                        organizationName={organizationName}
                        currentUserEmail={user?.email ?? null}
                        currentUserProfile={profile}
                        currentUserId={user?.id ?? null}
                        directGrants={sharedUsers}
                        onDirectGrantsChange={setSharedUsers}
                        orgOverrides={orgOverrides}
                        onOrgOverridesChange={setOrgOverrides}
                        ownerLabel={`${t.project} owners`}
                        visibility={visibility}
                    />
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col">
                        <FileDirectory
                            selectedDocuments={selectedDocuments}
                            onChange={setSelectedDocuments}
                            showTabs
                        />
                    </div>
                )}

                {error && (
                    // role="alert" so the failure is announced, not just
                    // painted red under a form the user may not be looking at.
                    <p role="alert" className="mt-3 text-sm text-red-500">
                        {error}
                    </p>
                )}
            </form>
            <WarningPopup
                open={unsupportedWarning !== null}
                title="Some files were skipped"
                message={unsupportedWarning ?? ""}
                onClose={() => setUnsupportedWarning(null)}
            />
        </Modal>
    );
}
