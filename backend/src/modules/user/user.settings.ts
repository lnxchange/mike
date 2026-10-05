import { createServerSupabase, type Db } from "../../lib/supabase";
import { type UserApiKeys } from "../../lib/llm";
import { type ReasoningLevel } from "../../lib/llm";
import { getUserApiKeys as getStoredUserApiKeys } from "./user.apiKeyStore";
import {
    getAllUserRouterModels,
} from "../../lib/routerModels";
import {
    normalizeOptionalModelPreference,
    normalizeReasoningLevel,
} from "../../lib/modelSelection";
import { resolveLegalResearchAu } from "./user.profile.serialization";

export type UserModelSettings = {
    /** Explicit override; null means derive the title model from the chat. */
    title_model: string | null;
    /** Default for new reviews only; each review stores its own model. */
    tabular_model: string | null;
    /** Explicit override for asynchronous memory curation. */
    memory_curator_model: string | null;
    /** Cross-surface fallback used only when a chat has no usable model. */
    last_selected_chat_model: string | null;
    /** Cross-surface fallback used only when a chat has no saved level. */
    last_selected_reasoning_level: ReasoningLevel | null;
    legal_research_us: boolean;
    legal_research_au: boolean;
    legal_research_au_energy: boolean;
    legal_research_au_vic: boolean;
    legal_research_au_cases: boolean;
    api_keys: UserApiKeys;
    personalisation?: {
        displayName: string | null;
        organisation: string | null;
        jurisdiction: string | null;
        practiceSetting: string | null;
        professionalTitle: string | null;
        practiceAreas: string[];
    };
};

export async function getUserModelSettings(
    userId: string,
    db?: Db,
): Promise<UserModelSettings> {
    const client = db ?? createServerSupabase();
    const [profileResult, api_keys, routerModels] = await Promise.all([
        client
            .from("user_profiles")
            .select(
                "title_model, tabular_model, memory_curator_model, last_selected_chat_model, last_selected_reasoning_level, legal_research_us, legal_research_au, legal_research_au_energy, legal_research_au_vic, legal_research_au_cases, display_name, organisation, jurisdiction, practice_setting, professional_title, practice_areas",
            )
            .eq("user_id", userId)
            .single(),
        getStoredUserApiKeys(userId, client),
        getAllUserRouterModels(userId, client),
    ]);
    let data = profileResult.data;
    let profileError = profileResult.error;

    if (
        profileError?.code === "42703" &&
        typeof profileError.message === "string" &&
        (profileError.message.includes("legal_research_au_vic") ||
            profileError.message.includes("legal_research_au_cases"))
    ) {
        const withoutVicCases = await client
            .from("user_profiles")
            .select(
                "title_model, tabular_model, memory_curator_model, last_selected_chat_model, last_selected_reasoning_level, legal_research_us, legal_research_au, legal_research_au_energy, display_name, organisation, jurisdiction, practice_setting, professional_title, practice_areas",
            )
            .eq("user_id", userId)
            .single();
        if (!withoutVicCases.error) {
            data = {
                ...withoutVicCases.data,
                legal_research_au_vic: null,
                legal_research_au_cases: null,
            } as typeof data;
            profileError = null;
        } else {
            profileError = withoutVicCases.error;
        }
    }

    if (
        profileError?.code === "42703" &&
        typeof profileError.message === "string" &&
        profileError.message.includes("legal_research_au_energy")
    ) {
        const withoutEnergy = await client
            .from("user_profiles")
            .select(
                "title_model, tabular_model, memory_curator_model, last_selected_chat_model, last_selected_reasoning_level, legal_research_us, legal_research_au, display_name, organisation, jurisdiction, practice_setting, professional_title, practice_areas",
            )
            .eq("user_id", userId)
            .single();
        if (!withoutEnergy.error) {
            data = {
                ...withoutEnergy.data,
                legal_research_au_energy: null,
                legal_research_au_vic: null,
                legal_research_au_cases: null,
            } as typeof data;
            profileError = null;
        } else {
            profileError = withoutEnergy.error;
        }
    }

    if (
        profileError?.code === "42703" &&
        typeof profileError.message === "string" &&
        profileError.message.includes("legal_research_au")
    ) {
        const withoutAu = await client
            .from("user_profiles")
            .select(
                "title_model, tabular_model, memory_curator_model, last_selected_chat_model, last_selected_reasoning_level, legal_research_us, display_name, organisation, jurisdiction, practice_setting, professional_title, practice_areas",
            )
            .eq("user_id", userId)
            .single();
        if (!withoutAu.error) {
            data = {
                ...withoutAu.data,
                legal_research_au: null,
                legal_research_au_energy: null,
                legal_research_au_vic: null,
                legal_research_au_cases: null,
            } as typeof data;
            profileError = null;
        } else {
            profileError = withoutAu.error;
        }
    }

    // Deploy-before-migrate tolerance for the memory curator preference. Keep
    // every previously available setting while the new nullable column is
    // still being rolled out.
    if (
        profileError?.code === "42703" &&
        typeof profileError.message === "string" &&
        profileError.message.includes("memory_curator_model")
    ) {
        const withoutMemoryCuratorModel = await client
            .from("user_profiles")
            .select(
                "title_model, tabular_model, last_selected_chat_model, last_selected_reasoning_level, legal_research_us, display_name, organisation, jurisdiction, practice_setting, professional_title, practice_areas",
            )
            .eq("user_id", userId)
            .single();
        if (!withoutMemoryCuratorModel.error) {
            data = {
                ...withoutMemoryCuratorModel.data,
                memory_curator_model: null,
            } as typeof data;
            profileError = null;
        } else {
            profileError = withoutMemoryCuratorModel.error;
        }
    }

    // A database that predates the 20260821 onboarding migration rejects the
    // select above outright (unknown column), which would silently fall every
    // caller back to default models and re-enable US legal research for users
    // who turned it off. Retry with the pre-migration column set so saved
    // settings keep working; personalisation simply stays empty.
    if (profileError?.code === "42703") {
        const withoutLastSelected = await client
            .from("user_profiles")
            .select(
                "title_model, tabular_model, last_selected_chat_model, legal_research_us, display_name, organisation, jurisdiction, practice_setting, professional_title, practice_areas",
            )
            .eq("user_id", userId)
            .single();
        if (!withoutLastSelected.error) {
            data = {
                ...withoutLastSelected.data,
                memory_curator_model: null,
                last_selected_reasoning_level: null,
            } as typeof data;
        } else if (withoutLastSelected.error.code === "42703") {
            const legacy = await client
                .from("user_profiles")
                .select("title_model, tabular_model, legal_research_us")
                .eq("user_id", userId)
                .single();
            // A second failure (a database even older than the pre-migration
            // shape) keeps data null and falls through to the defaults below.
            data = legacy.error
                ? null
                : ({
                      ...legacy.data,
                      memory_curator_model: null,
                      last_selected_chat_model: null,
                      last_selected_reasoning_level: null,
                  } as typeof data);
        } else {
            data = null;
        }
    }

    return {
        title_model: normalizeOptionalModelPreference(
            data?.title_model,
            routerModels,
        ),
        tabular_model: normalizeOptionalModelPreference(
            data?.tabular_model,
            routerModels,
        ),
        memory_curator_model: normalizeOptionalModelPreference(
            data?.memory_curator_model,
            routerModels,
        ),
        last_selected_chat_model: normalizeOptionalModelPreference(
            data?.last_selected_chat_model,
            routerModels,
        ),
        last_selected_reasoning_level: normalizeReasoningLevel(
            data?.last_selected_reasoning_level,
        ),
        legal_research_us:
            (data as { legal_research_us?: boolean | null } | null)
                ?.legal_research_us !== false,
        legal_research_au: resolveLegalResearchAu(
            (data as { legal_research_au?: boolean | null } | null)
                ?.legal_research_au,
            typeof data?.jurisdiction === "string" ? data.jurisdiction : null,
        ),
        legal_research_au_energy: resolveLegalResearchAu(
            (data as { legal_research_au_energy?: boolean | null } | null)
                ?.legal_research_au_energy,
            typeof data?.jurisdiction === "string" ? data.jurisdiction : null,
        ),
        legal_research_au_vic: resolveLegalResearchAu(
            (data as { legal_research_au_vic?: boolean | null } | null)
                ?.legal_research_au_vic,
            typeof data?.jurisdiction === "string" ? data.jurisdiction : null,
        ),
        legal_research_au_cases: resolveLegalResearchAu(
            (data as { legal_research_au_cases?: boolean | null } | null)
                ?.legal_research_au_cases,
            typeof data?.jurisdiction === "string" ? data.jurisdiction : null,
        ),
        personalisation: {
            displayName:
                typeof data?.display_name === "string"
                    ? data.display_name
                    : null,
            organisation:
                typeof data?.organisation === "string"
                    ? data.organisation
                    : null,
            jurisdiction:
                typeof data?.jurisdiction === "string"
                    ? data.jurisdiction
                    : null,
            practiceSetting:
                typeof data?.practice_setting === "string"
                    ? data.practice_setting
                    : null,
            professionalTitle:
                typeof data?.professional_title === "string"
                    ? data.professional_title
                    : null,
            practiceAreas: Array.isArray(data?.practice_areas)
                ? data.practice_areas.filter(
                      (area): area is string => typeof area === "string",
                  )
                : [],
        },
        api_keys,
    };
}

/** Save a reasoning level when the user explicitly selects it in a picker. */
export async function persistLastSelectedReasoningLevel(
    userId: string,
    reasoningLevel: ReasoningLevel,
    db: Db,
): Promise<unknown | null> {
    const { error } = await db
        .from("user_profiles")
        .update({
            last_selected_reasoning_level: reasoningLevel,
            updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    return error ?? null;
}

/** Save a model when the user explicitly selects it in a chat picker. */
export async function persistLastSelectedChatModel(
    userId: string,
    model: string,
    db: Db,
): Promise<unknown | null> {
    const { error } = await db
        .from("user_profiles")
        .update({
            last_selected_chat_model: model,
            updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    return error ?? null;
}

export async function getUserApiKeys(
    userId: string,
    db?: Db,
): Promise<UserApiKeys> {
    const client = db ?? createServerSupabase();
    return getStoredUserApiKeys(userId, client);
}
