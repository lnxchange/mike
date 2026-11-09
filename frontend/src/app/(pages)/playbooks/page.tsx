"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPlaybook, listPlaybooks, type PlaybookRecord } from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";

export default function PlaybooksPage() {
    const router = useRouter();
    const [playbooks, setPlaybooks] = useState<PlaybookRecord[]>([]);
    const [name, setName] = useState("");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void listPlaybooks()
            .then((rows) => {
                if (!cancelled) setPlaybooks(rows);
            })
            .catch((cause) => {
                if (!cancelled) {
                    setError(userFacingApiError(cause, "Playbooks could not be loaded."));
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    async function create() {
        const next = name.trim();
        if (!next) return;
        try {
            const created = await createPlaybook(next);
            router.push(`/playbooks/${created.id}`);
        } catch (cause) {
            setError(userFacingApiError(cause, "The playbook could not be created."));
        }
    }

    return (
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
            <div>
                <h1 className="font-serif text-2xl text-gray-900">Playbooks</h1>
                <p className="mt-2 text-sm text-gray-600">
                    A playbook holds the positions a review should apply to a contract.
                    A review quotes the contract and proposes a replacement only where
                    the text is actually there.
                </p>
            </div>
            <form
                className="flex gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    void create();
                }}
            >
                <label className="sr-only" htmlFor="playbook-name">
                    Playbook name
                </label>
                <input
                    id="playbook-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Liability playbook"
                    className="h-10 flex-1 rounded-lg bg-gray-100 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300/45"
                />
                <button
                    type="submit"
                    className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gray-300/45"
                >
                    New playbook
                </button>
            </form>
            {error && (
                <p role="alert" className="text-sm text-red-600">
                    {error}
                </p>
            )}
            <ul className="divide-y divide-gray-100">
                {playbooks.map((playbook) => (
                    <li key={playbook.id}>
                        <button
                            type="button"
                            onClick={() => router.push(`/playbooks/${playbook.id}`)}
                            className="flex w-full items-center justify-between py-3 text-left focus:outline-none focus:ring-2 focus:ring-gray-300/45"
                        >
                            <span className="text-sm text-gray-900">{playbook.name}</span>
                            <span className="text-xs text-gray-500">
                                {playbook.visibility === "public" ? "Public" : "Private"}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
