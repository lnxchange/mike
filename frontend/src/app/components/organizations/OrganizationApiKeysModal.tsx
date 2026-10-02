"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/app/components/modals/Modal";
import { ApiKeyField } from "@/app/components/settings/ApiKeyField";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import {
  getApiKeyStatus,
  getOrgApiKeyStatus,
  saveOrgApiKey,
  type ApiKeyProvider,
  type ApiKeyStatus,
} from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";

const MODEL_API_KEY_FIELDS = [
  {
    provider: "claude" as const,
    label: "Anthropic (Claude) API Key",
    placeholder: "sk-ant-...",
  },
  {
    provider: "gemini" as const,
    label: "Google (Gemini) API Key",
    placeholder: "AI...",
  },
  {
    provider: "openai" as const,
    label: "OpenAI API Key",
    placeholder: "sk-...",
  },
  {
    provider: "openrouter" as const,
    label: "OpenRouter API Key",
    placeholder: "sk-or-...",
  },
  {
    provider: "vercel" as const,
    label: "Vercel AI Gateway API Key",
    placeholder: "vck_...",
  },
  {
    provider: "opencode-go" as const,
    label: "OpenCode Go API Key",
    placeholder: "sk-...",
  },
];

function hasProviderKey(status: ApiKeyStatus | null, provider: ApiKeyProvider) {
  return !!status?.[provider];
}

export function OrganizationApiKeysModal({
  open,
  orgId,
  orgName,
  onClose,
}: {
  open: boolean;
  orgId: string;
  orgName: string;
  onClose: () => void;
}) {
  const [orgStatus, setOrgStatus] = useState<ApiKeyStatus | null>(null);
  const [personalStatus, setPersonalStatus] = useState<ApiKeyStatus | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [copyingProvider, setCopyingProvider] = useState<ApiKeyProvider | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextOrg, nextPersonal] = await Promise.all([
        getOrgApiKeyStatus(orgId),
        getApiKeyStatus(),
      ]);
      setOrgStatus(nextOrg);
      setPersonalStatus(nextPersonal);
    } catch (err) {
      setError(
        userFacingApiError(err, "Could not load organisation API keys."),
      );
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  async function saveProvider(provider: ApiKeyProvider, value: string) {
    const status = await saveOrgApiKey(orgId, provider, value.trim() || null);
    setOrgStatus(status);
    return true;
  }

  async function removeProvider(provider: ApiKeyProvider) {
    const status = await saveOrgApiKey(orgId, provider, null);
    setOrgStatus(status);
    return true;
  }

  async function copyPersonal(provider: ApiKeyProvider) {
    setCopyingProvider(provider);
    setError(null);
    try {
      const status = await saveOrgApiKey(orgId, provider, null, {
        usePersonal: true,
      });
      setOrgStatus(status);
    } catch (err) {
      setError(
        userFacingApiError(err, "Could not copy your personal API key."),
      );
    } finally {
      setCopyingProvider(null);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        breadcrumbs={["Organizations", orgName, "API keys"]}
        size="lg"
        cancelAction={{ label: "Done", onClick: onClose }}
      >
        <div className="flex flex-col gap-6 py-1">
          <p className="text-sm text-gray-500">
            Keys saved here are used by everyone in this organisation. Members
            do not need their own key. A personal key still overrides the
            organisation key for that person.
          </p>
          {loading && !orgStatus ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading keys
            </div>
          ) : (
            MODEL_API_KEY_FIELDS.map((field) => {
              const orgHasKey = hasProviderKey(orgStatus, field.provider);
              const canCopyPersonal =
                personalStatus?.sources?.[field.provider] === "user" &&
                !orgHasKey;
              return (
                <div key={field.provider} className="space-y-2">
                  <ApiKeyField
                    label={field.label}
                    placeholder={field.placeholder}
                    hasSavedKey={orgHasKey}
                    onSave={(value) => saveProvider(field.provider, value)}
                    onRemove={() => removeProvider(field.provider)}
                  />
                  {canCopyPersonal ? (
                    <div className="flex justify-end">
                      <PillButtonUI
                        type="button"
                        size="sm"
                        tone="white"
                        disabled={copyingProvider === field.provider}
                        loading={copyingProvider === field.provider}
                        onClick={() => void copyPersonal(field.provider)}
                      >
                        Use my personal key
                      </PillButtonUI>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </Modal>
      <WarningPopup
        open={error !== null}
        title="Organisation API keys"
        message={error}
        onClose={() => setError(null)}
      />
    </>
  );
}
