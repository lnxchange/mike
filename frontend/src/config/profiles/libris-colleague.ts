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
    // Designer Li swallowtail, not the retired tittle cut from the wordmark.
    // Theme lives in app/themes/libris-colleague.css and keys off data-profile.
    markSrc: "/brand/libris-li-icon.png",
    markSrcDark: "/brand/libris-li-icon-white.png",
    wordmarkSrc: "/brand/libris-logo-fullcolor.svg",
    wordmarkSrcDark: "/brand/libris-logo-reverse.png",
    wordmarkQualifier: "Colleague",
    iconSrc: "/brand/libris-li-icon.png",
    appleTouchIconSrc: "/brand/libris-apple-touch-icon.png",
  },
  // Australian law firms work in matters, not projects.
  terminology: {
    project: "Matter",
    projects: "Matters",
    projectLower: "matter",
    projectsLower: "matters",
    referenceNumber: "Matter number",
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
    zohoMatterPull: true,
  },
};
