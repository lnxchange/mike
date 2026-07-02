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
 * Not selected by default. Set NEXT_PUBLIC_DEPLOYMENT_PROFILE=mode-law to
 * activate it once real values are filled in.
 */
export const modeLawProfile: DeploymentProfile = {
  id: "mode-law",
  branding: {
    appName: "Mike",
    tagline: "AI-powered legal document analysis and contract review platform.",
    appUrl: "https://app.mikeoss.com",
    landingUrl: "https://mikeoss.com",
  },
  externalLinks: {
    terms: "https://mikeoss.com/terms",
    privacy: "https://mikeoss.com/privacy",
  },
  support: {
    email: "support@mikeoss.com",
  },
  allowedDocumentCategories: [],
  featureFlags: {
    modeLawIntegration: true,
  },
};
