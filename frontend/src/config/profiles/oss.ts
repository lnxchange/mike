import type { DeploymentProfile } from "../types";

/**
 * Default open-source profile. This is what every fresh checkout of this
 * repo runs with unless NEXT_PUBLIC_DEPLOYMENT_PROFILE is set to something
 * else.
 */
export const ossProfile: DeploymentProfile = {
  id: "oss",
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
    modeLawIntegration: false,
  },
};
