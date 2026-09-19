/**
 * Shape of a deployment profile. A profile is a pure data object — no
 * business logic — that customizes branding, feature flags, and external
 * links without touching application code or components. See
 * ../../../config/README.md for the full explanation of why this exists.
 */
export interface DeploymentProfile {
  /** Unique key, matches the NEXT_PUBLIC_DEPLOYMENT_PROFILE env var. */
  id: string;

  branding: {
    /** Product/brand name shown in the UI, page titles, and metadata. */
    appName: string;
    tagline: string;
    /** Canonical URL of this app itself, used for metadata/OpenGraph. */
    appUrl: string;
    /** Public marketing/landing site the logo links to (may differ from appUrl). */
    landingUrl: string;
    /**
     * Optional brand mark rendered in the logo lockup instead of the default
     * Mike icon. A path under frontend/public (for example "/brand/mark.svg").
     */
    markSrc?: string;
    /**
     * Optional browser tab icon (favicon). A path under frontend/public.
     * When unset, the stock Mike icon set is used.
     */
    iconSrc?: string;
    /**
     * Optional raster Apple touch icon (180x180 PNG). Safari does not accept
     * an SVG here, so a profile that sets iconSrc should set this too.
     * Falls back to iconSrc when unset.
     */
    appleTouchIconSrc?: string;
  };

  /**
   * User-visible nouns for the top-level workspace container. The OSS product
   * calls it a "project"; a law-firm deployment may call it a "matter". Only
   * copy reads these; routes, identifiers and API field names never change.
   */
  terminology: {
    /** Singular, capitalised: "Project". */
    project: string;
    /** Plural, capitalised: "Projects". */
    projects: string;
    /** Singular, lower case: "project". */
    projectLower: string;
    /** Plural, lower case: "projects". */
    projectsLower: string;
    /** Label for the client/matter reference field: "CM number". */
    referenceNumber: string;
  };

  externalLinks: {
    terms: string;
    privacy: string;
  };

  support: {
    email: string;
  };

  /**
   * Practice-area / document-category labels surfaced in the product.
   * Empty array means "no restriction, free text" — the current OSS
   * behavior.
   */
  allowedDocumentCategories: string[];

  featureFlags: {
    /**
     * Reserved for a future mode.law-specific integration surface. Not
     * implemented in this repo — exists so a future adapter has a flag to
     * check instead of needing a code change here.
     */
    modeLawIntegration: boolean;
  };
}
