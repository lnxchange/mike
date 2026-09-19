"use client";

import Image from "next/image";
import { MikeIcon } from "@/app/components/chat/mike-icon";
import { appConfig } from "@/config";

interface BrandMarkProps {
    size?: number;
    className?: string;
    /** Assistant is working: the Mike icon spins, a custom mark pulses. */
    spin?: boolean;
    /** Assistant just finished. Only the Mike icon has a visual for this. */
    done?: boolean;
    /** Assistant failed. Only the Mike icon has a visual for this. */
    error?: boolean;
}

/**
 * The product/assistant glyph. Renders the active deployment profile's
 * brand mark when one is configured, otherwise the stock Mike icon, so the
 * OSS profile is unchanged.
 */
export function BrandMark({
    size = 20,
    className,
    spin = false,
    done = false,
    error = false,
}: BrandMarkProps) {
    const markSrc = appConfig.branding.markSrc;
    if (markSrc) {
        return (
            <span
                className={`inline-block shrink-0 ${spin ? "animate-pulse" : ""} ${className ?? ""}`}
            >
                <Image
                    src={markSrc}
                    alt=""
                    aria-hidden
                    unoptimized
                    width={size}
                    height={size}
                    style={{ height: size, width: "auto" }}
                />
            </span>
        );
    }
    const icon = (
        <MikeIcon
            size={size}
            spin={spin}
            done={done}
            error={error}
            mike={!error && !done}
        />
    );
    if (!className) return icon;
    return <span className={className}>{icon}</span>;
}
