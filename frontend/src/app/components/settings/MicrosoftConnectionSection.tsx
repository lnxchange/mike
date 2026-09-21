"use client";

import { useEffect, useState } from "react";
import {
    getAuthConfig,
    startMicrosoftOAuth,
} from "@/app/lib/authApi";
import { useAuth } from "@/app/contexts/AuthContext";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { MicrosoftIconUI } from "@/shared/ui/MicrosoftIconUI";
import { SettingsCard } from "@/app/components/settings/SettingsCard";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import {
    SettingsDescription,
    SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { userFacingApiError } from "@/app/lib/userFacingError";

export function MicrosoftConnectionSection() {
    const { user, refreshSession } = useAuth();
    const [enabled, setEnabled] = useState(false);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void getAuthConfig()
            .then((config) => {
                if (!cancelled) setEnabled(config.microsoftEnabled);
            })
            .catch(() => {
                if (!cancelled) setEnabled(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (!enabled) return null;

    const connected = user?.microsoftConnected === true;

    async function connect() {
        setBusy(true);
        setStatus(null);
        try {
            const { url } = await startMicrosoftOAuth(
                "/settings/security",
                "link",
            );
            window.location.assign(url);
        } catch (error) {
            setStatus(
                userFacingApiError(
                    error,
                    "Microsoft could not be connected. Please try again.",
                ),
            );
            setBusy(false);
        }
    }

    async function disconnect() {
        setBusy(true);
        setStatus(null);
        try {
            const response = await fetch("/api/integrations/microsoft", {
                method: "DELETE",
                credentials: "include",
            });
            if (!response.ok) {
                throw new Error(
                    "Microsoft could not be disconnected. Please try again.",
                );
            }
            await refreshSession();
        } catch (error) {
            setStatus(
                userFacingApiError(
                    error,
                    "Microsoft could not be disconnected. Please try again.",
                ),
            );
        } finally {
            setBusy(false);
        }
    }

    return (
        <SettingsCard>
            <SettingsHeading>Microsoft</SettingsHeading>
            <SettingsRow>
                <div className="flex min-w-0 items-start gap-3">
                    <MicrosoftIconUI className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                        <SettingsLabel>
                            {connected ? "Connected" : "Not connected"}
                        </SettingsLabel>
                        <SettingsDescription>
                            {connected
                                ? "Review-only Outlook drafts can be staged in your mailbox."
                                : "Connect Microsoft to stage Outlook drafts from chat."}
                        </SettingsDescription>
                        {status ? (
                            <p className="mt-2 text-sm text-red-600">{status}</p>
                        ) : null}
                    </div>
                </div>
                {connected ? (
                    <PillButtonUI
                        type="button"
                        tone="white"
                        size="small"
                        disabled={busy}
                        onClick={() => void disconnect()}
                    >
                        Disconnect
                    </PillButtonUI>
                ) : (
                    <PillButtonUI
                        type="button"
                        tone="black"
                        size="small"
                        disabled={busy}
                        onClick={() => void connect()}
                    >
                        Connect
                    </PillButtonUI>
                )}
            </SettingsRow>
        </SettingsCard>
    );
}
