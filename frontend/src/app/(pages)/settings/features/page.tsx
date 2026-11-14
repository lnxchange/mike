"use client";

import { useState } from "react";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { GlassCardUI, ToggleSwitchUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { WebSearchSection } from "@/app/components/settings/WebSearchSection";
import { useUserProfile } from "@/app/contexts/UserProfileContext";

export default function FeaturesPage() {
  const {
    profile,
    updateLegalResearchAu,
    updateLegalResearchAuEnergy,
    updateLegalResearchAuVic,
    updateLegalResearchAuCases,
    updateQuickActionsVisible,
    updateResponseDetailsVisible,
  } = useUserProfile();
  const [savingAu, setSavingAu] = useState(false);
  const [savingAuEnergy, setSavingAuEnergy] = useState(false);
  const [savingAuVic, setSavingAuVic] = useState(false);
  const [savingAuCases, setSavingAuCases] = useState(false);
  const [savingQuickActions, setSavingQuickActions] = useState(false);
  const [savingResponseDetails, setSavingResponseDetails] = useState(false);
  const [auError, setAuError] = useState<string | null>(null);
  const [auEnergyError, setAuEnergyError] = useState<string | null>(null);
  const [auVicError, setAuVicError] = useState<string | null>(null);
  const [auCasesError, setAuCasesError] = useState<string | null>(null);
  const [optimisticLegalResearchAu, setOptimisticLegalResearchAu] = useState<
    boolean | null
  >(null);
  const [optimisticLegalResearchAuEnergy, setOptimisticLegalResearchAuEnergy] =
    useState<boolean | null>(null);
  const [optimisticLegalResearchAuVic, setOptimisticLegalResearchAuVic] =
    useState<boolean | null>(null);
  const [optimisticLegalResearchAuCases, setOptimisticLegalResearchAuCases] =
    useState<boolean | null>(null);

  const persistedLegalResearchAu = profile?.legalResearchAu ?? false;
  const persistedLegalResearchAuEnergy =
    profile?.legalResearchAuEnergy ?? false;
  const persistedLegalResearchAuVic = profile?.legalResearchAuVic ?? false;
  const persistedLegalResearchAuCases = profile?.legalResearchAuCases ?? false;
  const auLegislationEnabled =
    optimisticLegalResearchAu ?? persistedLegalResearchAu;
  const auEnergyEnabled =
    optimisticLegalResearchAuEnergy ?? persistedLegalResearchAuEnergy;
  const auVicEnabled =
    optimisticLegalResearchAuVic ?? persistedLegalResearchAuVic;
  const auCasesEnabled =
    optimisticLegalResearchAuCases ?? persistedLegalResearchAuCases;
  const quickActionsVisible = profile?.quickActionsVisible ?? true;
  const responseDetailsVisible = profile?.responseDetailsVisible ?? false;

  const setQuickActionsVisible = async (visible: boolean) => {
    setSavingQuickActions(true);
    // A failure is reported by the profile context's notice (with Retry);
    // the toggle reads the profile, so it is already back where it was.
    await updateQuickActionsVisible(visible);
    setSavingQuickActions(false);
  };

  const setResponseDetailsVisible = async (visible: boolean) => {
    setSavingResponseDetails(true);
    // As with quick actions, the profile context reports a failure and the
    // toggle, which reads the profile, stays where it was.
    await updateResponseDetailsVisible(visible);
    setSavingResponseDetails(false);
  };

  const handleAuLegislationChange = async (enabled: boolean) => {
    if (savingAu) return;
    setAuError(null);
    setOptimisticLegalResearchAu(enabled);
    setSavingAu(true);
    const ok = await updateLegalResearchAu(enabled);
    setSavingAu(false);
    setOptimisticLegalResearchAu(null);
    if (!ok) {
      setAuError("Could not update. Try again.");
    }
  };

  const handleAuEnergyChange = async (enabled: boolean) => {
    if (savingAuEnergy) return;
    setAuEnergyError(null);
    setOptimisticLegalResearchAuEnergy(enabled);
    setSavingAuEnergy(true);
    const ok = await updateLegalResearchAuEnergy(enabled);
    setSavingAuEnergy(false);
    setOptimisticLegalResearchAuEnergy(null);
    if (!ok) {
      setAuEnergyError("Could not update. Try again.");
    }
  };

  const handleAuVicChange = async (enabled: boolean) => {
    if (savingAuVic) return;
    setAuVicError(null);
    setOptimisticLegalResearchAuVic(enabled);
    setSavingAuVic(true);
    const ok = await updateLegalResearchAuVic(enabled);
    setSavingAuVic(false);
    setOptimisticLegalResearchAuVic(null);
    if (!ok) {
      setAuVicError("Could not update. Try again.");
    }
  };

  const handleAuCasesChange = async (enabled: boolean) => {
    if (savingAuCases) return;
    setAuCasesError(null);
    setOptimisticLegalResearchAuCases(enabled);
    setSavingAuCases(true);
    const ok = await updateLegalResearchAuCases(enabled);
    setSavingAuCases(false);
    setOptimisticLegalResearchAuCases(null);
    if (!ok) {
      setAuCasesError("Could not update. Try again.");
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SettingsHeading id="assistant-features">Assistant</SettingsHeading>
        <GlassCardUI>
          <SettingsRow>
            <div className="min-w-0 space-y-1">
              <SettingsLabel>Quick actions</SettingsLabel>
              <SettingsDescription>
                Show the quick actions row on the assistant start screen.
              </SettingsDescription>
            </div>
            <ToggleSwitchUI
              checked={quickActionsVisible}
              disabled={savingQuickActions}
              aria-busy={savingQuickActions}
              aria-label="Quick actions"
              onCheckedChange={(checked) => {
                void setQuickActionsVisible(checked);
              }}
            />
          </SettingsRow>
          <SettingsRow>
            <div className="min-w-0 space-y-1">
              <SettingsLabel>Response details</SettingsLabel>
              <SettingsDescription>
                Show the model, reasoning effort and token count under each
                response and subagent.
              </SettingsDescription>
            </div>
            <ToggleSwitchUI
              checked={responseDetailsVisible}
              disabled={savingResponseDetails}
              aria-busy={savingResponseDetails}
              aria-label="Response details"
              onCheckedChange={(checked) => {
                void setResponseDetailsVisible(checked);
              }}
            />
          </SettingsRow>
        </GlassCardUI>
      </section>

      <section className="space-y-3">
        <SettingsHeading id="legal-research">Legal Research</SettingsHeading>
        <GlassCardUI>
          <SettingsRow>
            <div className="min-w-0 space-y-1">
              <SettingsLabel>
                Australian legislation (Commonwealth)
              </SettingsLabel>
              <SettingsDescription>
                Search and read Commonwealth Acts and legislative instruments
                from the Federal Register of Legislation. No API key is
                required.
              </SettingsDescription>
              {auError && (
                <p className="text-sm text-red-600" role="alert">
                  {auError}
                </p>
              )}
            </div>
            <ToggleSwitchUI
              checked={auLegislationEnabled}
              disabled={savingAu}
              aria-busy={savingAu}
              aria-label="Australian legislation (Commonwealth)"
              onCheckedChange={(enabled) =>
                void handleAuLegislationChange(enabled)
              }
            />
          </SettingsRow>
          <SettingsRow>
            <div className="min-w-0 space-y-1">
              <SettingsLabel>Australian energy law</SettingsLabel>
              <SettingsDescription>
                Search and read Victorian ESC energy instruments, the
                national energy Laws and adoption Acts, AEMC rule books,
                AER guidelines, and AEMO procedures. No API key is required.
              </SettingsDescription>
              {auEnergyError && (
                <p className="text-sm text-red-600" role="alert">
                  {auEnergyError}
                </p>
              )}
            </div>
            <ToggleSwitchUI
              checked={auEnergyEnabled}
              disabled={savingAuEnergy}
              aria-busy={savingAuEnergy}
              aria-label="Australian energy law"
              onCheckedChange={(enabled) => void handleAuEnergyChange(enabled)}
            />
          </SettingsRow>
          <SettingsRow>
            <div className="min-w-0 space-y-1">
              <SettingsLabel>Victorian legislation</SettingsLabel>
              <SettingsDescription>
                Search and read Victorian Acts and statutory rules from
                legislation.vic.gov.au. No API key is required.
              </SettingsDescription>
              {auVicError && (
                <p className="text-sm text-red-600" role="alert">
                  {auVicError}
                </p>
              )}
            </div>
            <ToggleSwitchUI
              checked={auVicEnabled}
              disabled={savingAuVic}
              aria-busy={savingAuVic}
              aria-label="Victorian legislation"
              onCheckedChange={(enabled) => void handleAuVicChange(enabled)}
            />
          </SettingsRow>
          <SettingsRow>
            <div className="min-w-0 space-y-1">
              <SettingsLabel>Australian case law</SettingsLabel>
              <SettingsDescription>
                Search and read High Court, Federal Court, NSW Caselaw, and
                recent Supreme Court of Victoria PDFs. No API key is required.
              </SettingsDescription>
              {auCasesError && (
                <p className="text-sm text-red-600" role="alert">
                  {auCasesError}
                </p>
              )}
            </div>
            <ToggleSwitchUI
              checked={auCasesEnabled}
              disabled={savingAuCases}
              aria-busy={savingAuCases}
              aria-label="Australian case law"
              onCheckedChange={(enabled) => void handleAuCasesChange(enabled)}
            />
          </SettingsRow>
        </GlassCardUI>
      </section>

      <WebSearchSection />
    </div>
  );
}
