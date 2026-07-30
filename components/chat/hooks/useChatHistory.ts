/**
 * Owns the chat transcript: React state, hydration from sessionStorage, and
 * write-back persistence. Also tracks whether the next API call should start a
 * fresh server session (true until this tab has sent a real user message).
 */

import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  clearStoredMessages,
  clearStoredSessionId,
  loadStoredMessages,
  loadStoredSessionId,
  saveStoredMessages,
  saveStoredSessionId,
} from "@/components/chat/chatStorage";
import type { ChatMessage } from "@/components/chat/types";

export interface ChatHistory {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  hydrated: boolean;
  /** First API message after a fresh UI / "New chat" rotates the server session. */
  startNewSessionRef: MutableRefObject<boolean>;
  /** Replace the transcript and clear persisted history (used by "New chat"). */
  resetMessages: (initial: ChatMessage[]) => void;
  /** Persist the server session id returned by /api/chat. */
  rememberSessionId: (sessionId: string) => void;
}

export function useChatHistory(): ChatHistory {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const startNewSessionRef = useRef(true);

  useEffect(() => {
    const stored = loadStoredMessages();
    const storedSessionId = loadStoredSessionId();
    startTransition(() => {
      if (stored.length > 0) {
        setMessages(stored);
        // Resume the cookie session only when this tab already had a real
        // conversation AND we still know which server session owned it.
        const hasUserTurn = stored.some((m) => m.role === "user");
        startNewSessionRef.current = !(hasUserTurn && Boolean(storedSessionId));
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveStoredMessages(messages);
  }, [messages, hydrated]);

  function resetMessages(initial: ChatMessage[]) {
    startNewSessionRef.current = true;
    setMessages(initial);
    clearStoredMessages();
    clearStoredSessionId();
  }

  function rememberSessionId(sessionId: string) {
    const trimmed = sessionId.trim();
    if (!trimmed) return;
    saveStoredSessionId(trimmed);
  }

  return {
    messages,
    setMessages,
    hydrated,
    startNewSessionRef,
    resetMessages,
    rememberSessionId,
  };
}
