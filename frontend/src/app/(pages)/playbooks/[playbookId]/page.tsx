"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
    getPlaybook,
    runPlaybook,
    savePlaybook,
    type PlaybookFinding,
    type PlaybookRule,
} from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";

export default function PlaybookEditorPage() {
    const params = useParams<{ playbookId: string }>();
    const [name, setName] = useState("");
    const [rules, setRules] = useState<PlaybookRule[]>([]);
    const [role, setRole] = useState("viewer");
    const [documentId, setDocumentId] = useState("");
    const [summary, setSummary] = useState("");
    const [findings, setFindings] = useState<PlaybookFinding[]>([]);
    const [status, setStatus] = useState<string | null>(null);
    const [statusIsError, setStatusIsError] = useState(false);
    const canEdit = role === "owner" || role === "editor";

    useEffect(() => {
        let cancelled = false;
        void getPlaybook(params.playbookId)
            .then((loaded) => {
                if (cancelled) return;
                setName(loaded.playbook.name);
                setRules(loaded.playbook.content?.rules ?? []);
                setRole(loaded.role);
            })
            .catch((cause) => {
                if (!cancelled) {
                    setStatusIsError(true);
                    setStatus(userFacingApiError(cause, "The playbook could not be loaded."));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [params.playbookId]);

    function updateRule(index: number, patch: Partial<PlaybookRule>) {
        setRules((current) =>
            current.map((rule, ruleIndex) =>
                ruleIndex === index ? { ...rule, ...patch } : rule,
            ),
        );
    }

    async function save() {
        setStatus("Saving...");
        setStatusIsError(false);
        try {
            await savePlaybook(params.playbookId, { rules });
            setStatus("Saved");
        } catch (cause) {
            setStatusIsError(true);
            setStatus(userFacingApiError(cause, "The playbook could not be saved."));
        }
    }

    async function review() {
        setStatus("Reviewing...");
        setStatusIsError(false);
        try {
            const result = await runPlaybook(params.playbookId, documentId.trim());
            setSummary(result.summary);
            setFindings(result.findings);
            setStatus("Review finished");
        } catch (cause) {
            setStatusIsError(true);
            setStatus(userFacingApiError(cause, "The review could not be run."));
        }
    }

    return (
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
            <div>
                <h1 className="font-serif text-2xl text-gray-900">{name || "Playbook"}</h1>
                <p className="mt-2 text-sm text-gray-600">
                    Standard is the position you want. A fallback still needs review
                    in strict mode. Unacceptable positions are applied first.
                </p>
            </div>
            <div className="space-y-4">
                {rules.map((rule, index) => (
                    <fieldset
                        key={rule.id}
                        className="space-y-2 rounded-lg bg-gray-50 p-4"
                    >
                        <legend className="text-sm text-gray-900">{rule.name}</legend>
                        <label className="block text-xs text-gray-600" htmlFor={`concept-${rule.id}`}>
                            Concept
                        </label>
                        <textarea
                            id={`concept-${rule.id}`}
                            value={rule.concept}
                            disabled={!canEdit}
                            rows={2}
                            onChange={(event) =>
                                updateRule(index, { concept: event.target.value })
                            }
                            className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300/45"
                        />
                        <label className="block text-xs text-gray-600" htmlFor={`standard-${rule.id}`}>
                            Standard position
                        </label>
                        <textarea
                            id={`standard-${rule.id}`}
                            value={rule.standard}
                            disabled={!canEdit}
                            rows={2}
                            onChange={(event) =>
                                updateRule(index, { standard: event.target.value })
                            }
                            className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300/45"
                        />
                        <label className="block text-xs text-gray-600" htmlFor={`unacceptable-${rule.id}`}>
                            Unacceptable positions, one per line
                        </label>
                        <textarea
                            id={`unacceptable-${rule.id}`}
                            value={rule.unacceptable.join("\n")}
                            disabled={!canEdit}
                            rows={2}
                            onChange={(event) =>
                                updateRule(index, {
                                    unacceptable: event.target.value
                                        .split("\n")
                                        .map((line) => line.trim())
                                        .filter(Boolean),
                                })
                            }
                            className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300/45"
                        />
                    </fieldset>
                ))}
            </div>
            {canEdit && (
                <button
                    type="button"
                    onClick={() => void save()}
                    className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gray-300/45"
                >
                    Save rules
                </button>
            )}
            <form
                className="space-y-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    void review();
                }}
            >
                <label className="block text-sm text-gray-900" htmlFor="review-document">
                    Document to review
                </label>
                <input
                    id="review-document"
                    value={documentId}
                    onChange={(event) => setDocumentId(event.target.value)}
                    placeholder="Document id"
                    className="h-10 w-full rounded-lg bg-gray-100 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300/45"
                />
                <button
                    type="submit"
                    className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gray-300/45"
                >
                    Run review
                </button>
            </form>
            {status && (
                <p
                    role={statusIsError ? "alert" : "status"}
                    className={statusIsError ? "text-sm text-red-600" : "text-sm text-gray-500"}
                >
                    {status}
                </p>
            )}
            {summary && <p className="text-sm text-gray-800">{summary}</p>}
            <ul className="space-y-3">
                {findings.map((finding, index) => (
                    <li key={`${finding.ruleName}-${index}`} className="text-sm text-gray-800">
                        <p className="font-medium">
                            {finding.ruleName} ({finding.status})
                        </p>
                        {finding.quote && <p className="mt-1">{finding.quote}</p>}
                        <p className="mt-1 text-gray-600">{finding.analysis}</p>
                        {finding.suggestedText && (
                            <p className="mt-1">{finding.suggestedText}</p>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
