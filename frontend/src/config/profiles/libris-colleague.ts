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
    // Libris bookmark glyph, copied from lnxchange/libris-design-system
    // assets/logo/libris-bookmark.svg. The theme lives in
    // app/themes/libris-colleague.css and keys off data-profile.
    markSrc: "/brand/libris-bookmark.svg",
    iconSrc: "/brand/libris-bookmark.svg",
    // Rasterised from the same SVG (rsvg-convert, 180px, padded square).
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
