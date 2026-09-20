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

function BrandImage({
    src,
    darkSrc,
    size,
    className,
}: {
    src: string;
    darkSrc?: string;
    size: number;
    className?: string;
}) {
    const image = (url: string, extraClass: string) => (
        <Image
            src={url}
            alt=""
            aria-hidden
            unoptimized
            width={size}
            height={size}
            className={extraClass}
            style={{ height: size, width: "auto" }}
        />
    );

    return (
        <span className={`inline-flex shrink-0 items-center ${className ?? ""}`}>
            {darkSrc ? (
                <>
                    {image(src, "dark:hidden")}
                    {image(darkSrc, "hidden dark:block")}
                </>
            ) : (
                image(src, "")
            )}
        </span>
    );
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
            <BrandImage
                src={markSrc}
                darkSrc={appConfig.branding.markSrcDark}
                size={size}
                className={spin ? `animate-pulse ${className ?? ""}` : className}
            />
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
