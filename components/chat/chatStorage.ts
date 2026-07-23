/**
 * Session-scoped persistence for the chat transcript. Isolates all
 * sessionStorage access (and its failure modes) from the React components.
 */

import { STORAGE_KEY } from "@/components/chat/constants";
import type { ChatMessage } from "@/components/chat/types";
import { sanitizeChatAttachments } from "@/lib/chat/attachments";

function normalizeMessage(value: unknown): ChatMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  if (typeof m.id !== "string") return null;
  if (m.role !== "user" && m.role !== "assistant") return null;
  if (typeof m.content !== "string") return null;

  const message: ChatMessage = {
    id: m.id,
    role: m.role,
    content: m.content,
  };
  if (m.showMenu === true) message.showMenu = true;

  const attachments = sanitizeChatAttachments(m.attachments);
  if (attachments.length) message.attachments = attachments;

  return message;
}

/** Read the persisted transcript, returning [] when absent or malformed. */
export function loadStoredMessages(): ChatMessage[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeMessage)
      .filter((m): m is ChatMessage => m !== null);
  } catch {
    return [];
  }
}

/** Persist the transcript, ignoring quota/availability errors. */
export function saveStoredMessages(messages: ChatMessage[]): void {
  try {
    const safe = messages.map((m) => {
      const attachments = sanitizeChatAttachments(m.attachments);
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        ...(m.showMenu ? { showMenu: true } : {}),
        ...(attachments.length ? { attachments } : {}),
      };
    });
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // storage full or unavailable
  }
}

/** Clear the persisted transcript, ignoring availability errors. */
export function clearStoredMessages(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
