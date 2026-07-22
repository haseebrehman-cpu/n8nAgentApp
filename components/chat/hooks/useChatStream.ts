/**
 * Owns the request lifecycle for sending a message: the "assistant is typing"
 * state and the AbortController that cancels an in-flight/previous request.
 * Delegates the actual network + SSE parsing to `streamChatReply`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  streamChatReply,
  type StreamChatHandlers,
} from "@/lib/chat/client/streamChatReply";

const UNREACHABLE_REPLY =
  "I couldn't reach the assistant right now. Please try again shortly.";

export interface ChatStream {
  isTyping: boolean;
  /** Send a message and stream the reply, reporting content via handlers. */
  send: (
    params: { message: string; newSession: boolean },
    handlers: StreamChatHandlers,
  ) => Promise<void>;
  /** Abort any in-flight request and clear the typing state. */
  stop: () => void;
}

export function useChatStream(): ChatStream {
  const [isTyping, setIsTyping] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const send = useCallback<ChatStream["send"]>(
    async ({ message, newSession }, handlers) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setIsTyping(true);

      try {
        await streamChatReply({ message, newSession, signal: ac.signal }, handlers);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handlers.onAssistantContent(UNREACHABLE_REPLY);
      } finally {
        if (abortRef.current === ac) {
          setIsTyping(false);
        }
      }
    },
    [],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsTyping(false);
  }, []);

  return { isTyping, send, stop };
}
