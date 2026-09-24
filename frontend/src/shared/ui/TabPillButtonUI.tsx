"use client";

import type { ComponentProps, ReactElement } from "react";
import { tabPillButtonUIClassName } from "./TabPillButtonUI.styles";

export type TabPillButtonUIProps = ComponentProps<"button"> & {
    active?: boolean;
};

/** Canonical tab-style pill shared by the web app and Word add-in. */
export function TabPillButtonUI({
    active,
    type = "button",
    className,
    ...props
}: TabPillButtonUIProps): ReactElement {
    return (
        <button
            data-slot="tab-pill-button"
            type={type}
            aria-pressed={active}
            className={tabPillButtonUIClassName({ active, className })}
            {...props}
        />
    );
}
