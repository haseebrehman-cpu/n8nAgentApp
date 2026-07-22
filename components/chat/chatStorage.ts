/**
 * Session-scoped persistence for the chat transcript. Isolates all
 * sessionStorage access (and its failure modes) from the React components.
 */

import { STORAGE_KEY } from "@/components/chat/constants";
import type { ChatMessage } from "@/components/chat/types";

/** Read the persisted transcript, returning [] when absent or malformed. */
export function loadStoredMessages(): ChatMessage[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ChatMessage =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as ChatMessage).id === "string" &&
        ((m as ChatMessage).role === "user" ||
          (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).content === "string",
    );
  } catch {
    return [];
  }
}

/** Persist the transcript, ignoring quota/availability errors. */
export function saveStoredMessages(messages: ChatMessage[]): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
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
