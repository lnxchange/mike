"use client";

import { useEffect } from "react";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { appConfig } from "@/config";

export default function GlobalError({
    error,
}: {
    error: Error & { digest?: string };
}) {
    useEffect(() => {
        console.error("Global error:", error);
    }, [error]);

    const libris = appConfig.id === "libris-colleague";
    const sans = libris ? "Source Sans Pro" : "Inter";
    const display = libris ? "Grenze" : "EB Garamond";
    const fontHref = libris
        ? "https://fonts.googleapis.com/css2?family=Grenze:wght@600&family=Source+Sans+Pro:wght@400;600&display=swap"
        : "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=EB+Garamond:wght@400;500&display=swap";

    return (
        <html lang="en">
            <head>
                <title>{`Something went wrong – ${appConfig.branding.appName}`}</title>
                <style>{`
                    @import url('${fontHref}');

                    * { margin: 0; padding: 0; box-sizing: border-box; }

                    body {
                        font-family: '${sans}', -apple-system, BlinkMacSystemFont, sans-serif;
                        background-color: #ffffff;
                        color: #111;
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }

                    .error-container {
                        text-align: center;
                        max-width: 480px;
                        padding: 2rem;
                    }

                    .error-title {
                        font-family: '${display}', Georgia, serif;
                        font-size: 1.75rem;
                        font-weight: ${libris ? 600 : 400};
                        color: #111;
                        margin-bottom: 0.75rem;
                    }

                    .error-message {
                        font-size: 0.9375rem;
                        color: #6b7280;
                        line-height: 1.6;
                        margin-bottom: 2rem;
                    }

                    .btn-back { font-family: '${sans}', sans-serif; }
                `}</style>
            </head>
            <body>
                <div className="error-container">
                    <h1 className="error-title">Something went wrong</h1>
                    <p className="error-message">
                        We encountered an unexpected error. This has been logged
                        and our team will look into it.
                    </p>
                    <PillButtonUI
                        tone="blue"
                        size="normal"
                        className="btn-back"
                        onClick={() => window.history.back()}
                    >
                        Back
                    </PillButtonUI>
                </div>
            </body>
        </html>
    );
}
