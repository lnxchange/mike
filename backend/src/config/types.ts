/**
 * Shape of a deployment profile. A profile is a pure data object — no
 * business logic — that customizes branding, default prompts, and feature
 * flags without touching application code. See ../../../config/README.md
 * for the full explanation of why this exists.
 */
export interface DeploymentProfile {
  /** Unique key, matches the DEPLOYMENT_PROFILE env var. */
  id: string;

  /** Human-readable name, used only in logs/docs. */
  label: string;

  branding: {
    /** Name the assistant refers to itself as in system prompts. */
    assistantName: string;
  };

  /**
   * Practice-area / document-category labels surfaced in the product (e.g.
   * workflow "practice" field suggestions). Empty array means "no
   * restriction, free text" — the current OSS behavior.
   */
  allowedDocumentCategories: string[];

  /** Simple on/off switches read by application code via `appConfig.featureFlags`. */
  featureFlags: {
    /**
     * Reserved for a future mode.law-specific integration surface (e.g. a
     * proprietary matter-management sync). Not implemented in this repo —
     * exists so a future adapter has a flag to check instead of needing a
     * code change here.
     */
    modeLawIntegration: boolean;
  };

  support: {
    email: string;
  };
}
