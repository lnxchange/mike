"use client";

import { useState } from "react";
import { ApiKeyField } from "@/app/components/settings/ApiKeyField";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { SettingsCard } from "@/app/components/settings/SettingsCard";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { ToggleSwitchUI } from "@/shared/ui/ToggleSwitchUI";
import { useUserProfile } from "@/app/contexts/UserProfileContext";

export default function FeaturesPage() {
  const {
    profile,
    updateApiKey,
    updateLegalResearchUs,
    updateLegalResearchAu,
    updateLegalResearchAuEnergy,
    updateLegalResearchAuVic,
    updateLegalResearchAuCases,
    updateQuickActionsVisible,
  } = useUserProfile();
  const [quickActionsError, setQuickActionsError] = useState<string | null>(
    null,
  );
  const [savingUs, setSavingUs] = useState(false);
  const [savingAu, setSavingAu] = useState(false);
  const [savingAuEnergy, setSavingAuEnergy] = useState(false);
  const [savingAuVic, setSavingAuVic] = useState(false);
  const [savingAuCases, setSavingAuCases] = useState(false);
  const [savingQuickActions, setSavingQuickActions] = useState(false);
  const [usError, setUsError] = useState<string | null>(null);
  const [auError, setAuError] = useState<string | null>(null);
  const [auEnergyError, setAuEnergyError] = useState<string | null>(null);
  const [auVicError, setAuVicError] = useState<string | null>(null);
  const [auCasesError, setAuCasesError] = useState<string | null>(null);
  const [optimisticLegalResearchUs, setOptimisticLegalResearchUs] = useState<
    boolean | null
  >(null);
  const [optimisticLegalResearchAu, setOptimisticLegalResearchAu] = useState<
    boolean | null
  >(null);
  const [optimisticLegalResearchAuEnergy, setOptimisticLegalResearchAuEnergy] =
    useState<boolean | null>(null);
  const [optimisticLegalResearchAuVic, setOptimisticLegalResearchAuVic] =
    useState<boolean | null>(null);
  const [optimisticLegalResearchAuCases, setOptimisticLegalResearchAuCases] =
    useState<boolean | null>(null);

  const persistedLegalResearchUs = profile?.legalResearchUs ?? true;
  const persistedLegalResearchAu = profile?.legalResearchAu ?? false;
  const persistedLegalResearchAuEnergy =
    profile?.legalResearchAuEnergy ?? false;
  const persistedLegalResearchAuVic = profile?.legalResearchAuVic ?? false;
  const persistedLegalResearchAuCases = profile?.legalResearchAuCases ?? false;
  const courtListenerEnabled =
    optimisticLegalResearchUs ?? persistedLegalResearchUs;
  const auLegislationEnabled =
    optimisticLegalResearchAu ?? persistedLegalResearchAu;
  const auEnergyEnabled =
    optimisticLegalResearchAuEnergy ?? persistedLegalResearchAuEnergy;
  const auVicEnabled =
    optimisticLegalResearchAuVic ?? persistedLegalResearchAuVic;
  const auCasesEnabled =
    optimisticLegalResearchAuCases ?? persistedLegalResearchAuCases;
  const quickActionsVisible = profile?.quickActionsVisible ?? true;

  const setQuickActionsVisible = async (visible: boolean) => {
    setQuickActionsError(null);
    setSavingQuickActions(true);
    const ok = await updateQuickActionsVisible(visible);
    setSavingQuickActions(false);
    if (!ok) setQuickActionsError("Could not update. Try again.");
  };

  const handleCourtListenerChange = async (enabled: boolean) => {
    if (savingUs) return;
    setUsError(null);
    setOptimisticLegalResearchUs(enabled);
    setSavingUs(true);
    const ok = await updateLegalResearchUs(enabled);
    setSavingUs(false);
    setOptimisticLegalResearchUs(null);
    if (!ok) {
      setUsError("Could not update. Try again.");
    }
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
        <SettingsHeading>Assistant</SettingsHeading>
        <SettingsCard>
          <SettingsRow>
            <div className="min-w-0 space-y-1">
              <SettingsLabel>Quick actions</SettingsLabel>
              <SettingsDescription>
                Show the quick actions row on the assistant start screen.
              </SettingsDescription>
              {quickActionsError && (
                <p className="text-sm text-red-600" role="alert">
                  {quickActionsError}
                </p>
              )}
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
        </SettingsCard>
      </section>

      <section className="space-y-3">
        <SettingsHeading>Legal Research</SettingsHeading>
        <SettingsCard>
          <SettingsRow>
            <div className="min-w-0 space-y-1">
              <SettingsLabel>Enable CourtListener</SettingsLabel>
              <SettingsDescription>
                CourtListener provides access to US case law.
              </SettingsDescription>
              {usError && (
                <p className="text-sm text-red-600" role="alert">
                  {usError}
                </p>
              )}
            </div>
            <ToggleSwitchUI
              checked={courtListenerEnabled}
              disabled={savingUs}
              aria-busy={savingUs}
              aria-label="Enable CourtListener"
              onCheckedChange={(enabled) =>
                void handleCourtListenerChange(enabled)
              }
            />
          </SettingsRow>
          {courtListenerEnabled && (
            <ApiKeyField
              label="CourtListener API Key"
              placeholder="Token..."
              hasSavedKey={profile?.apiKeys.courtlistener.source === "user"}
              onSave={(value) =>
                updateApiKey("courtlistener", value.trim() || null)
              }
              onRemove={() => updateApiKey("courtlistener", null)}
            />
          )}
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
        </SettingsCard>
      </section>
    </div>
  );
}
