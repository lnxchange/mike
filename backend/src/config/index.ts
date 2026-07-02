import type { DeploymentProfile } from "./types";
import { ossProfile } from "./profiles/oss";
import { modeLawProfile } from "./profiles/mode-law";

const PROFILES: Record<string, DeploymentProfile> = {
  [ossProfile.id]: ossProfile,
  [modeLawProfile.id]: modeLawProfile,
};

function resolveProfile(): DeploymentProfile {
  const requested = process.env.DEPLOYMENT_PROFILE?.trim();
  if (!requested) return ossProfile;
  const match = PROFILES[requested];
  if (!match) {
    console.warn(
      `[mike] Unknown DEPLOYMENT_PROFILE "${requested}", falling back to "${ossProfile.id}". ` +
        `Known profiles: ${Object.keys(PROFILES).join(", ")}.`,
    );
    return ossProfile;
  }
  return match;
}

/**
 * Active deployment profile, resolved once at module load from
 * DEPLOYMENT_PROFILE. See ../../../config/README.md for the intent behind
 * this layer.
 */
export const appConfig: DeploymentProfile = resolveProfile();

export type { DeploymentProfile } from "./types";
