import type { DeploymentProfile } from "./types";
import { ossProfile } from "./profiles/oss";
import { modeLawProfile } from "./profiles/mode-law";

const PROFILES: Record<string, DeploymentProfile> = {
  [ossProfile.id]: ossProfile,
  [modeLawProfile.id]: modeLawProfile,
};

function resolveProfile(): DeploymentProfile {
  // NEXT_PUBLIC_ prefix required: this config drives client-visible
  // branding (page titles, links), so it must be readable in the browser
  // bundle, not just on the server.
  const requested = process.env.NEXT_PUBLIC_DEPLOYMENT_PROFILE?.trim();
  if (!requested) return ossProfile;
  return PROFILES[requested] ?? ossProfile;
}

/**
 * Active deployment profile, resolved once at module load from
 * NEXT_PUBLIC_DEPLOYMENT_PROFILE. See ../../../config/README.md for the
 * intent behind this layer.
 */
export const appConfig: DeploymentProfile = resolveProfile();

export type { DeploymentProfile } from "./types";
