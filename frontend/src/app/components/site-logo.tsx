import Link from "next/link";
import Image from "next/image";
import { BrandMark } from "@/app/components/brand-mark";
import { appConfig } from "@/config";

interface SiteLogoProps {
    size?: "sm" | "md" | "lg" | "xl";
    className?: string;
    iconClassName?: string;
    animate?: boolean;
    asLink?: boolean;
    /** Sidebar lockup should not introduce a second page heading. */
    as?: "h1" | "div";
}

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

const wordmarkHeights = {
    sm: 28,
    md: 32,
    lg: 48,
    xl: 64,
};

function Wordmark({
    src,
    darkSrc,
    height,
    alt,
}: {
    src: string;
    darkSrc?: string;
    height: number;
    alt: string;
}) {
    const image = (url: string, extraClass: string, decorative: boolean) => (
        <Image
            src={url}
            alt={decorative ? "" : alt}
            aria-hidden={decorative || undefined}
            unoptimized
            width={Math.round(height * 2.4)}
            height={height}
            className={extraClass}
            style={{ height, width: "auto" }}
        />
    );

    if (!darkSrc) return image(src, "block", false);

    return (
        <>
            {image(src, "block dark:hidden", false)}
            {image(darkSrc, "hidden dark:block", true)}
        </>
    );
}

export function SiteLogo({
    size = "md",
    className = "",
    iconClassName = "",
    animate = false,
    asLink = false,
    as = "h1",
}: SiteLogoProps) {
    const landingHref =
        process.env.NODE_ENV === "production"
            ? appConfig.branding.landingUrl
            : "http://localhost:3000";
    const Tag = as;
    const wordmarkSrc = appConfig.branding.wordmarkSrc;
    const qualifier = appConfig.branding.wordmarkQualifier;

    const logo = (
        <Tag
            className={`flex items-center gap-1.5 ${sizeClasses[size]} font-semibold font-display ${
                animate ? "sidebar-fade-in" : ""
            } ${className}`}
        >
            {wordmarkSrc ? (
                <>
                    <span
                        className={`inline-flex shrink-0 items-center leading-none ${iconClassName}`}
                    >
                        <Wordmark
                            src={wordmarkSrc}
                            darkSrc={appConfig.branding.wordmarkSrcDark}
                            height={wordmarkHeights[size]}
                            alt={qualifier ? "Libris" : appConfig.branding.appName}
                        />
                    </span>
                    {qualifier ? <span>{qualifier}</span> : null}
                </>
            ) : (
                <>
                    <span
                        className={`inline-flex shrink-0 items-center leading-none ${iconClassName}`}
                    >
                        <BrandMark size={iconSizes[size]} />
                    </span>
                    <span>{appConfig.branding.appName}</span>
                </>
            )}
        </Tag>
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
