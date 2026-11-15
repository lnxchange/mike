import type { DeploymentProfile } from "../types";

/**
 * Default open-source profile. This is what every fresh checkout of this
 * repo runs with unless DEPLOYMENT_PROFILE is set to something else.
 */
export const ossProfile: DeploymentProfile = {
  id: "oss",
  label: "Mike (open source)",
  branding: {
    assistantName: "Mike",
  },
  allowedDocumentCategories: [],
  featureFlags: {
    modeLawIntegration: false,
  },
  support: {
    email: "support@mikeoss.com",
  },
};
