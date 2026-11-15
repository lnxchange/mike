// User profile, personal settings and connector operations.
// Cross-domain account/export workflows live in application/.
export { errorMessage } from "./user.shared";

export {
    validateProfilePayload,
    validateOnboardingPayload,
    normalizeRouterModels,
    readBooleanBodyField,
    bootstrapUserProfile,
    getUserProfile,
    lookupUserByEmail,
    updateUserProfile,
    completeUserOnboarding,
    recordPasswordSet,
} from "./user.profile";

export { setUserProfilePhoto } from "./user.photo";

export { setMfaOnLogin } from "./user.mfa";
export { setApiKeyEnabled } from "./user.apiKeys";

export {
    getCustomInstructions,
    saveCustomInstructions,
    validateCustomInstructionsPayload,
} from "./user.customInstructions";

export {
    getResponseStyle,
    saveResponseStyle,
    validateResponseStylePayload,
} from "./user.responseStyle";

export {
    getWebSearchSettings,
    saveWebSearchSettings,
    validateWebSearchPayload,
} from "./user.webSearch";

export { getApiKeyStatus, saveApiKey } from "./user.apiKeys";

export {
    listMcpConnectors,
    getMcpConnector,
    createMcpConnector,
    updateMcpConnector,
    deleteMcpConnector,
    startMcpConnectorOAuth,
    refreshMcpConnectorTools,
    setMcpToolEnabled,
} from "./user.mcp";

export {
    courtListenerConnectorStatus,
    setCourtListenerEnabled,
    setCourtListenerToken,
} from "./user.courtlistener";

// Per-user settings are user-domain data that other
// modules (chat, project-chat, word-chat, tabular, models, source-documents)
// read through this facade rather than reaching into the topic files.
export {
    getUserModelSettings,
    persistLastSelectedChatModel,
    persistLastSelectedReasoningLevel,
    type UserModelSettings,
} from "./user.settings";

// Credential storage lives in lib/providerCredentials. These names stay on
// the facade because already-merged callers still import them from here.
export {
    getUserApiKeys,
    saveUserApiKey,
} from "../../lib/providerCredentials/store";

export { resolveUserChatSelection } from "./user.chatSelection";

export { handleMcpRefreshToken, MCP_TOKEN_REFRESH_WINDOW_MS } from "./user.mcpJobs";
