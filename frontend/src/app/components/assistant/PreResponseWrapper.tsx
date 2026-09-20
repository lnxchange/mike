"use client";

import type { ReactNode } from "react";
import { PreResponseWrapperUI } from "@/shared/ui/PreResponseWrapperUI";

export function PreResponseWrapper({
    children,
    stepCount,
    shouldMinimize,
    isStreaming,
    forceOpen = false,
    incomplete = false,
}: {
    children: ReactNode;
    stepCount: number;
    shouldMinimize: boolean;
    isStreaming: boolean;
    forceOpen?: boolean;
    incomplete?: boolean;
}) {
    return (
        <PreResponseWrapperUI
            stepCount={stepCount}
            shouldMinimize={shouldMinimize}
            isStreaming={isStreaming}
            forceOpen={forceOpen}
            incomplete={incomplete}
        >
            {children}
        </PreResponseWrapperUI>
    );
}
