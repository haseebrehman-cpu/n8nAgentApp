import { describe, expect, it } from "vitest";
import {
  acquireSessionLock,
  appendAssistantMessage,
  appendUserMessage,
  MAX_HISTORY_MESSAGES,
  releaseSessionLock,
  resetConversationState,
  setConversationState,
  setLastShownProducts,
  type ChatSession,
} from "@/lib/chat/session";

function makeSession(): ChatSession {
  return {
    id: "test",
    messages: [],
    state: "idle",
    pendingOrderNumber: null,
    pendingCategory: null,
    lastShownProducts: null,
    lastSearchQuery: null,
    catalogContext: null,
    version: 0,
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

  it("stores product memory on the session for follow-ups", () => {
    const session = makeSession();
    setLastShownProducts(session, [
      {
        id: "gid://shopify/Product/1",
        title: "F4 Gloves",
        price: "£40",
        wasPrice: null,
        url: null,
        inStock: true,
        onSale: false,
      },
    ]);
    expect(session.lastShownProducts).toHaveLength(1);
    expect(session.lastShownProducts?.[0]?.title).toBe("F4 Gloves");
    setLastShownProducts(session, null);
    expect(session.lastShownProducts).toBeNull();
  });

  it("serializes per-session locks in memory fallback", async () => {
    const id = `lock-test-${Date.now()}`;
    expect(await acquireSessionLock(id, "a")).toBe(true);
    expect(await acquireSessionLock(id, "b")).toBe(false);
    await releaseSessionLock(id, "a");
    expect(await acquireSessionLock(id, "b")).toBe(true);
    await releaseSessionLock(id, "b");
  });
});
