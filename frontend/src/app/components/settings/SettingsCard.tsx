import type { ReactNode } from "react";
import { GlassCardUI } from "@mike/ui";

export function SettingsCard({ children }: { children: ReactNode }) {
  return <GlassCardUI>{children}</GlassCardUI>;
}
