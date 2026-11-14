"use client";

import type { ReactNode } from "react";
import { PreResponseWrapperUI } from "@mike/ui";

export function PreResponseWrapper({
    children,
    stepCount,
    subagentCount,
    shouldMinimize,
    isStreaming,
    forceOpen = false,
    incomplete = false,
}: {
    children: ReactNode;
    stepCount: number;
    subagentCount?: number;
    shouldMinimize: boolean;
    isStreaming: boolean;
    forceOpen?: boolean;
    incomplete?: boolean;
}) {
    return (
        <PreResponseWrapperUI
            stepCount={stepCount}
            subagentCount={subagentCount}
            shouldMinimize={shouldMinimize}
            isStreaming={isStreaming}
            forceOpen={forceOpen}
            incomplete={incomplete}
        >
            {children}
        </PreResponseWrapperUI>
    );
}
