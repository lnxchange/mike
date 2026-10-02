import type { DeploymentProfile } from "../types";

/**
 * Attune Legal / Libris deployment of this app. Selected with
 * DEPLOYMENT_PROFILE=libris-colleague. The OSS default stays "Mike"; only
 * this profile changes the name the assistant uses for itself.
 */
export const librisColleagueProfile: DeploymentProfile = {
  id: "libris-colleague",
  label: "Libris Colleague",
  branding: {
    assistantName: "Libris Colleague",
  },
  allowedDocumentCategories: [],
  featureFlags: {
    modeLawIntegration: false,
  },
  support: {
    email: "yule@attune.legal",
  },
};
