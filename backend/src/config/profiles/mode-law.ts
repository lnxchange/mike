import type { DeploymentProfile } from "../types";

/**
 * Placeholder for a future mode.law deployment profile.
 *
 * This file intentionally contains NO proprietary mode.law branding,
 * business logic, or content — only the same generic structure as
 * `oss.ts`, so this repo can later be pointed at a mode.law-branded
 * configuration by (a) filling in the values below, or (b) replacing this
 * file's contents entirely in a private fork/overlay, without touching any
 * application code.
 *
 * Not selected by default. Set DEPLOYMENT_PROFILE=mode-law to activate it
 * once real values are filled in.
 */
export const modeLawProfile: DeploymentProfile = {
  id: "mode-law",
  label: "mode.law (placeholder — not yet configured)",
  branding: {
    assistantName: "Mike",
  },
  allowedDocumentCategories: [],
  featureFlags: {
    modeLawIntegration: true,
  },
  support: {
    email: "support@mikeoss.com",
  },
};
