/** Feature barrel: conversational AI chat. */
export {
  runChatAgent,
  isOrderTrackingIntent,
  isOffTopicQuery,
  shouldForceProductSearch,
  extractOrderLookupToken,
} from "@/lib/chat-agent";
export {
  getOrCreateSession,
  saveSession,
  type ChatSession,
  type ConversationState,
} from "@/lib/chat/session";
export { SYSTEM_PROMPT } from "@/lib/system-prompt";
export { stripAssistantMedia, sanitizeReply } from "@/lib/sanitize";
