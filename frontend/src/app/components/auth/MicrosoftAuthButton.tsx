"use client";

import { useEffect, useState } from "react";
import { MicrosoftIconUI } from "@/shared/ui/MicrosoftIconUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { getAuthConfig, startMicrosoftOAuth } from "@/app/lib/authApi";

interface MicrosoftAuthButtonProps {
    onError: (message: string) => void;
    disabled?: boolean;
    onLoadingChange?: (loading: boolean) => void;
}

export function MicrosoftAuthButton({
    onError,
    disabled = false,
    onLoadingChange,
}: MicrosoftAuthButtonProps) {
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(false);

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

    const handleMicrosoftAuth = async () => {
        setLoading(true);
        onLoadingChange?.(true);
        onError("");

        try {
            const { url } = await startMicrosoftOAuth("/onboarding/profile");
            window.location.assign(url);
        } catch (error: unknown) {
            onError(
                error instanceof Error
                    ? error.message
                    : "Unable to continue with Microsoft",
            );
            setLoading(false);
            onLoadingChange?.(false);
        }
    };

    return (
        <PillButtonUI
            type="button"
            tone="white"
            size="normal"
            className="w-full"
            disabled={disabled || loading}
            loading={loading}
            onClick={() => void handleMicrosoftAuth()}
        >
            <MicrosoftIconUI className="h-4 w-4" />
            {loading ? "Continuing…" : "Continue with Microsoft"}
        </PillButtonUI>
    );
}
