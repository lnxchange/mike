// Stable public API. Keep implementations in the topic files below.
export {
  getAccessibleChat,
} from "./chat.access";
export { getChatMessages } from "./chat.messages";
export {
  listChats,
  createChat,
  deleteChat,
  discardRejectedChatInput,
  type ChatWriteResult,
} from "./chat.crud";
export {
  listChatPeople,
  listChatGrants,
  grantChatAccess,
  revokeChatAccess,
  leaveChat,
  withChatLeaveAccess,
} from "./chat.sharing";
export { updateChatSettings } from "./chat.settings";
export { updateChatTitle } from "./chat.titles";
export {
  activeTurnFromChatRow,
  bindChatTurnStream,
  claimChatTurn,
  discardChatInputMessage,
  heartbeatChatTurn,
  releaseChatTurn,
  requestChatTurnCancel,
  startChatTurnHeartbeat,
  turnInProgressBody,
  withRunningTurnMessage,
  CHAT_TURN_HEARTBEAT_MS,
  CHAT_TURN_STALE_AFTER_SECONDS,
  type ActiveChatTurn,
  type ChatTurnLease,
  type ChatTurnRow,
  type ClaimChatTurnResult,
  type RunningAssistantMessage,
} from "./chat.turns";
export {
  cancelRunningTurn,
  finishRunningTurn,
  getRunningTurn,
  recordTurnFrame,
  startRunningTurn,
  subscribeToTurn,
  type RunningTurn,
} from "./chat.turnRegistry";
export { type PreparedChatStream, prepareChatStream } from "./chat.prepare";
export {
    schedulePlanContinuation,
    type PlanContinuationRequest,
} from "./chat.planRun";
export { decidePlanContinuation } from "./engine/tools/planTools";
export { stageOutlookPreview } from "./chat.outlookDraft";
export {
  devLog,
  appendAssistantEventsToMessage,
  AssistantStreamError,
  assistantStreamErrorPayload,
  ASSISTANT_ERROR_MESSAGE,
  buildCancelledAssistantMessage,
  buildStoppedAssistantEvent,
  buildStoppedAssistantMessage,
  extractCitations,
  isAbortError,
  runLLMStream,
  stripTransientAssistantEvents,
  throwIfTurnStopped,
  PROJECT_EXTRA_TOOLS,
  parseChatMessages,
  parseOptionalAskInputsResponse,
  parseOptionalAttachedDocuments,
  parseOptionalChatId,
  parseOptionalDisplayedDoc,
  parseOptionalModel,
  parseOptionalReasoning,
  buildProjectDocContext,
  buildMessages,
  loadUserMessageSentTimes,
  userMessageStamper,
  type MessageTimeContext,
  buildUserPersonalisationPrompt,
  buildWorkflowStore,
  attachPriorReasoning,
  createAssistantHistoryLoader,
  enrichWithPriorEvents,
  appendAskInputsResponseToAssistantMessage,
  runApprovedConnectorActions,
  writeApprovedConnectorFrames,
  generateSpotlightNonce,
  spotlightFilename,
  createSubagentRunStore,
  purgeExpiredSubagentRuns,
  type AskInputsResponseRequest,
  type AssistantEvent,
  type ChatDocumentReference,
  type ChatMessage,
  type SubagentDefaults,
  type TabularCellStore,
  TABULAR_TOOLS,
  parseOptionalDocumentContext,
  createReservedAssistantMessageUpdater,
  createWordClientToolsAdapter,
  isClientToolCallPending,
  logAssistantMessageFailure,
  requestIdOf,
  reserveAssistantMessage,
  submitClientToolResult,
  ACTIVE_WORD_DOCUMENT_ID,
  buildDocContext,
  buildWordChatSystemPrompt,
  WORD_CHAT_TOOL_NAMES,
  wordChatAllowedToolNames,
  type WordResearchFlags,
  withoutEmptyAssistantReservations,
} from "./engine/index";
export { generateAssistantChatTitle, logChatTitleFailure } from "./chat.title";

export {
  persistWordDocumentEdits,
  WORD_EDIT_FORMATS,
  isAllowedWordEditFormat,
  type WordEditApplyMode,
} from "./engine/wordDocumentEdits";
