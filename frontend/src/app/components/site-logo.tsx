import Image from "next/image";
import Link from "next/link";
import { MikeIcon } from "@/app/components/chat/mike-icon";
import { appConfig } from "@/config";

interface SiteLogoProps {
    size?: "sm" | "md" | "lg" | "xl";
    className?: string;
    iconClassName?: string;
    animate?: boolean;
    asLink?: boolean;
}

export function SiteLogo({
    size = "md",
    className = "",
    iconClassName = "",
    animate = false,
    asLink = false,
}: SiteLogoProps) {
    const landingHref =
        process.env.NODE_ENV === "production"
            ? appConfig.branding.landingUrl
            : "http://localhost:3000";
    const sizeClasses = {
        sm: "text-xl",
        md: "text-2xl",
        lg: "text-4xl",
        xl: "text-6xl",
    };

    const iconSizes = {
        sm: 20,
        md: 22,
        lg: 30,
        xl: 48,
    };

    const iconSize = iconSizes[size];
    const markSrc = appConfig.branding.markSrc;

    const logo = (
        <h1
            className={`flex items-center gap-1.5 ${sizeClasses[size]} font-light font-display ${
                animate ? "sidebar-fade-in" : ""
            } ${className}`}
        >
            <span
                className={`inline-flex shrink-0 items-center leading-none ${iconClassName}`}
            >
                {markSrc ? (
                    <Image
                        src={markSrc}
                        alt=""
                        aria-hidden
                        width={iconSize}
                        height={iconSize}
                        unoptimized
                        style={{ height: iconSize, width: "auto" }}
                    />
                ) : (
                    <MikeIcon size={iconSize} />
                )}
            </span>
            <span>{appConfig.branding.appName}</span>
        </h1>
    );

    if (asLink) {
        return (
            <Link
                href={landingHref}
                className="cursor-pointer hover:opacity-80 transition-opacity"
            >
                {logo}
            </Link>
        );
    }

    return logo;
}
