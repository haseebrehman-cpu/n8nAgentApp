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
  loadStoredMessages,
  saveStoredMessages,
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
}

export function useChatHistory(): ChatHistory {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const startNewSessionRef = useRef(true);

  useEffect(() => {
    const stored = loadStoredMessages();
    startTransition(() => {
      if (stored.length > 0) {
        setMessages(stored);
        // Only resume the cookie session if this tab already had a real conversation.
        startNewSessionRef.current = !stored.some((m) => m.role === "user");
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
  }

  return { messages, setMessages, hydrated, startNewSessionRef, resetMessages };
}
