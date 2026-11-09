"use client";

import { useEffect, useState } from "react";
import { SettingsCard } from "@/app/components/settings/SettingsCard";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { SETTINGS_CONTROL_CLASS } from "@/app/components/settings/SettingsTextInput";
import {
    getCustomInstructions,
    getResponseStyle,
    saveCustomInstructions,
    saveResponseStyle,
    type ResponseStyle,
} from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";

const STYLE_FIELDS: {
    field: keyof ResponseStyle;
    label: string;
    options: { value: string; label: string }[];
}[] = [
    {
        field: "verbosity",
        label: "Length",
        options: [
            { value: "concise", label: "Concise" },
            { value: "balanced", label: "Balanced" },
            { value: "detailed", label: "Detailed" },
        ],
    },
    {
        field: "formatting",
        label: "Headers and lists",
        options: [
            { value: "less", label: "Fewer" },
            { value: "balanced", label: "Balanced" },
            { value: "more", label: "More" },
        ],
    },
    {
        field: "tone",
        label: "Tone",
        options: [
            { value: "formal", label: "Formal" },
            { value: "balanced", label: "Balanced" },
            { value: "plain", label: "Plain" },
        ],
    },
];

const EMPTY_STYLE: ResponseStyle = {
    verbosity: "balanced",
    formatting: "balanced",
    tone: "balanced",
};

export function ResponseVoiceSection() {
    const [style, setStyle] = useState<ResponseStyle>(EMPTY_STYLE);
    const [instructions, setInstructions] = useState("");
    const [ready, setReady] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [statusIsError, setStatusIsError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void Promise.all([getResponseStyle(), getCustomInstructions()])
            .then(([loadedStyle, loadedInstructions]) => {
                if (cancelled) return;
                setStyle(loadedStyle);
                setInstructions(loadedInstructions.content);
                setReady(true);
            })
            .catch((error) => {
                if (cancelled) return;
                setStatusIsError(true);
                setStatus(
                    userFacingApiError(
                        error,
                        "Answer settings could not be loaded.",
                    ),
                );
            });
        return () => {
            cancelled = true;
        };
    }, []);

    async function changeStyle(field: keyof ResponseStyle, value: string) {
        const previous = style;
        const next = { ...style, [field]: value };
        setStyle(next);
        setStatus("Saving...");
        setStatusIsError(false);
        try {
            const saved = await saveResponseStyle({ [field]: value });
            setStyle(saved);
            setStatus("Saved");
        } catch (error) {
            setStyle(previous);
            setStatusIsError(true);
            setStatus(
                userFacingApiError(error, "Answer settings could not be saved."),
            );
        }
    }

    async function saveInstructions() {
        setStatus("Saving...");
        setStatusIsError(false);
        try {
            const saved = await saveCustomInstructions(instructions);
            setInstructions(saved.content);
            setStatus("Saved");
        } catch (error) {
            setStatusIsError(true);
            setStatus(
                userFacingApiError(
                    error,
                    "Custom instructions could not be saved.",
                ),
            );
        }
    }

    if (!ready) return null;

    return (
        <section className="space-y-3">
            <SettingsHeading>How answers are written</SettingsHeading>
            <SettingsDescription>
                These choices apply to every assistant conversation. A request
                in the chat takes precedence for that answer.
            </SettingsDescription>
            <SettingsCard>
                {STYLE_FIELDS.map((item) => (
                    <SettingsRow key={item.field}>
                        <label
                            htmlFor={`response-${item.field}`}
                            className="text-sm text-gray-900"
                        >
                            {item.label}
                        </label>
                        <select
                            id={`response-${item.field}`}
                            value={style[item.field]}
                            onChange={(event) =>
                                void changeStyle(item.field, event.target.value)
                            }
                            className={`${SETTINGS_CONTROL_CLASS} h-10 max-w-xs`}
                        >
                            {item.options.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </SettingsRow>
                ))}
                <SettingsRow layout="stacked">
                    <label
                        htmlFor="custom-instructions"
                        className="text-sm text-gray-900"
                    >
                        Custom instructions
                    </label>
                    <textarea
                        id="custom-instructions"
                        value={instructions}
                        maxLength={8000}
                        rows={6}
                        onChange={(event) => setInstructions(event.target.value)}
                        placeholder="Australian English. No em dashes. Lead with the conclusion."
                        className={`${SETTINGS_CONTROL_CLASS} py-2`}
                    />
                    <div className="flex items-center justify-end gap-3">
                        {status && (
                            <span
                                className={
                                    statusIsError
                                        ? "text-xs text-red-600"
                                        : "text-xs text-gray-500"
                                }
                                role={statusIsError ? "alert" : "status"}
                            >
                                {status}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => void saveInstructions()}
                            className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gray-300/45"
                        >
                            Save instructions
                        </button>
                    </div>
                </SettingsRow>
            </SettingsCard>
        </section>
    );
}
