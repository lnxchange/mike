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
