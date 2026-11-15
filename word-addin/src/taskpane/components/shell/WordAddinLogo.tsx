import React from "react";
import wordmark from "../../../../../frontend/public/brand/libris-logo-fullcolor.svg";
import { cn } from "../../../shared/lib/utils";

interface WordAddinLogoProps {
  size?: "md" | "lg";
  className?: string;
}

/** Libris Colleague lockup shared by branded Word add-in surfaces. */
export function WordAddinLogo({
  size = "md",
  className,
}: WordAddinLogoProps): React.ReactElement {
  const large = size === "lg";
  return (
    <div className={cn("flex items-center gap-1.5 text-gray-950", className)}>
      <img
        src={wordmark}
        alt="Libris"
        style={{ height: large ? 48 : 32, width: "auto" }}
      />
      <span
        className={cn(
          "font-serif font-semibold",
          large ? "text-4xl" : "text-2xl",
        )}
      >
        Colleague
      </span>
    </div>
  );
}
