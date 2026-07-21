import { describe, expect, it } from "vitest";
import {
  appendAssistantMessage,
  appendUserMessage,
  MAX_HISTORY_MESSAGES,
  resetConversationState,
  setConversationState,
  type ChatSession,
} from "@/lib/chat/session";

function makeSession(): ChatSession {
  return {
    id: "test",
    messages: [],
    state: "idle",
    pendingOrderNumber: null,
    pendingCategory: null,
    updatedAt: Date.now(),
    intent: null,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

describe("chat session state machine", () => {
  it("tracks awaiting order email with pending number", () => {
    const session = makeSession();
    setConversationState(session, "awaiting_order_email", "1001");
    expect(session.state).toBe("awaiting_order_email");
    expect(session.pendingOrderNumber).toBe("1001");
    resetConversationState(session);
    expect(session.state).toBe("idle");
    expect(session.pendingOrderNumber).toBeNull();
  });

  it("trims history when appending", () => {
    const session = makeSession();
    for (let i = 0; i < MAX_HISTORY_MESSAGES + 10; i++) {
      appendUserMessage(session, `u${i}`);
      appendAssistantMessage(session, `a${i}`);
    }
    expect(session.messages.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    expect(session.messages.at(-1)?.role).toBe("assistant");
  });
});
