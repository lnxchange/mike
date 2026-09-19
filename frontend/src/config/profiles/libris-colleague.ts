import type { DeploymentProfile } from "../types";

/**
 * Attune Legal / Libris deployment of this app. Selected with
 * NEXT_PUBLIC_DEPLOYMENT_PROFILE=libris-colleague. The OSS default stays
 * "Mike"; only this profile changes the public product name.
 */
export const librisColleagueProfile: DeploymentProfile = {
  id: "libris-colleague",
  branding: {
    appName: "Libris Colleague",
    tagline: "AI colleague for legal document analysis and contract review.",
    appUrl: "https://libris-colleague-lnxchanges-projects.vercel.app",
    landingUrl: "https://libris.au",
  },
  externalLinks: {
    terms: "https://libris.au",
    privacy: "https://libris.au",
  },
  support: {
    email: "yule@attune.legal",
  },
  allowedDocumentCategories: [],
  featureFlags: {
    modeLawIntegration: false,
  },
};
