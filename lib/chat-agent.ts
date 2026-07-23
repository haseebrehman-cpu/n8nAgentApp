/**
 * Conversational agent orchestrator. Drives a single chat turn: deterministic
 * routing (safety, discounts, order tracking) followed by an OpenAI
 * tool-calling loop backed by Shopify's hosted Storefront MCP server. Intent
 * classification, tool execution, MCP framing, and canned replies live in
 * dedicated modules under `lib/chat/`; this file only orchestrates them.
 *
 * The intent classifiers are re-exported here so existing imports of
 * `@/lib/chat-agent` (routes, feature barrels, tests) keep working.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  isValidEmailInput,
  isValidOrderNumberInput,
  normalizeEmail,
  normalizeOrderNumber,
} from "@/lib/chatbot/orderTracking";
import type { ChatSession, ConversationState } from "@/lib/chat/session";
import {
  addTokenUsage,
  appendAssistantMessage,
  resetConversationState,
  setConversationState,
  setLastShownProducts,
  setSessionIntent,
} from "@/lib/chat/session";
import {
  buildContextBlock,
  extractShownProducts,
  type ShownProduct,
} from "@/lib/chat/context/product-memory";
import { logger } from "@/lib/logger";
import { stripAssistantMedia } from "@/lib/sanitize";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import type { ChatMessagePayload } from "@/lib/types";
import type { RunChatAgentOptions } from "@/lib/chat/types";
import {
  extractEmailFromText,
  extractOrderLookupToken,
  extractOrderNumberFromText,
  hasRecentProductContext,
  isAmbiguousBrowseQuery,
  isDiscountCodeQuery,
  isDiscountQuery,
  // isHarmfulQuery,
  isHumanEscalationRequest,
  isOffTopicQuery,
  isOrderTrackingIntent,
  isProductFollowUpQuery,
  shouldForceProductSearch,
  stripOrderTrackingPhrases,
} from "@/lib/chat/intent";
import {
  AGENT_WALL_CLOCK_MS,
  CATALOG_TOOLS,
  LARGE_LIST_COMPLETION_TOKENS,
  LARGE_PAYLOAD_CHARS,
  MAX_COMPLETION_TOKENS,
  MAX_TOOL_ROUNDS,
} from "@/lib/chat/agent/config";
import { tools } from "@/lib/chat/agent/tools";
import { combineDeadline, getClient } from "@/lib/chat/agent/openai-client";
import { runTool } from "@/lib/chat/agent/tool-runner";
import { lookupOrderReply } from "@/lib/chat/agent/order-lookup";
import { extractCatalogData } from "@/lib/chat/agent/mcp-format";
import { getOpenAIConfig } from "@/lib/config";
import {
  ASK_ORDER_EMAIL_REPLY,
  ASK_ORDER_NUMBER_CLARIFY_REPLY,
  ASK_ORDER_NUMBER_REPLY,
  CONTENT_FILTERED_REPLY,
  DISCOUNT_CODE_REPLY,
  FALLBACK_REPLY,
  // HARMFUL_QUERY_REPLY,
  HUMAN_ESCALATION_REPLY,
  NOT_AVAILABLE_REPLY,
  OFF_TOPIC_REPLY,
  ORDER_EMAIL_STILL_NEEDED_REPLY,
} from "@/lib/chat/messaging/replies";

export * from "@/lib/chat/intent";
export { OFF_TOPIC_REPLY } from "@/lib/chat/messaging/replies";
export type { RunChatAgentOptions } from "@/lib/chat/types";

/** Append the reply to the session and advance/reset conversation state. */
function finishWithReply(
  session: ChatSession,
  reply: string,
  nextState: ConversationState = "idle",
  pendingOrderNumber: string | null = null,
): string {
  const cleaned = stripAssistantMedia(reply) || FALLBACK_REPLY;
  appendAssistantMessage(session, cleaned);
  if (nextState === "idle") {
    resetConversationState(session);
  } else {
    setConversationState(session, nextState, pendingOrderNumber);
  }
  return cleaned;
}

/** Stable intent labels persisted on the session / Mongo chat document. */
function resolveTurnIntent(lastUser: string, session: ChatSession): string {
  if (
    session.state === "awaiting_order_email" ||
    session.state === "awaiting_order_number"
  ) {
    return "order_tracking";
  }
  if (isHumanEscalationRequest(lastUser)) return "human_support";
  if (isOrderTrackingIntent(lastUser) || extractOrderLookupToken(lastUser)) {
    return "order_tracking";
  }
  if (isDiscountCodeQuery(lastUser)) return "discount_code";
  if (
    shouldForceProductSearch(lastUser) ||
    isAmbiguousBrowseQuery(lastUser) ||
    isProductFollowUpQuery(lastUser) ||
    isDiscountQuery(lastUser) ||
    /^product information$/i.test(lastUser.trim())
  ) {
    return "product_information";
  }
  if (isOffTopicQuery(lastUser)) return "off_topic";
  return "general";
}

/**
 * Run the agent using the server session (authoritative history + state).
 * Mutates session messages/state; caller must persist.
 */
export async function runChatAgent(
  history: ChatMessagePayload[],
  options: RunChatAgentOptions,
): Promise<string> {
  const { session, region, requestId } = options;
  const signal = combineDeadline(options.signal, AGENT_WALL_CLOCK_MS);
  const client = getClient();
  const { model } = getOpenAIConfig();

  const lastUser =
    [...history].reverse().find((m) => m.role === "user")?.content ?? "";

  // Safety first: refuse dangerous/illegal requests before any tool routing.
  // "RDX" is our brand but also an explosive, so guard against misuse.
  // if (isHarmfulQuery(lastUser)) {
  //   setSessionIntent(session, "off_topic");
  //   return finishWithReply(session, HARMFUL_QUERY_REPLY);
  // }

  if (isDiscountCodeQuery(lastUser)) {
    setSessionIntent(session, "discount_code");
    return finishWithReply(session, DISCOUNT_CODE_REPLY);
  }

  // Human handoff: escalate immediately rather than looping the customer.
  if (isHumanEscalationRequest(lastUser)) {
    setSessionIntent(session, "human_support");
    return finishWithReply(session, HUMAN_ESCALATION_REPLY);
  }

  // --- Explicit conversation state machine (not regex on assistant text) ---
  if (session.state === "awaiting_order_email") {
    setSessionIntent(session, "order_tracking");
    const email = extractEmailFromText(lastUser) ?? normalizeEmail(lastUser);
    const orderNumber = session.pendingOrderNumber;
    if (email && orderNumber) {
      const reply = await lookupOrderReply(orderNumber, email, {
        region,
        signal,
      });
      return finishWithReply(session, reply, "idle");
    }
    // Customer changed topic (product question, off-topic, etc.) — leave tracking flow.
    if (!extractEmailFromText(lastUser) && !isValidEmailInput(lastUser)) {
      resetConversationState(session);
    } else {
      return finishWithReply(
        session,
        ORDER_EMAIL_STILL_NEEDED_REPLY,
        "awaiting_order_email",
        orderNumber,
      );
    }
  }

  if (session.state === "awaiting_order_number") {
    setSessionIntent(session, "order_tracking");
    if (isValidOrderNumberInput(lastUser)) {
      const orderNumber = normalizeOrderNumber(lastUser)!;
      const email = extractEmailFromText(lastUser);
      if (email) {
        const reply = await lookupOrderReply(orderNumber, email, {
          region,
          signal,
        });
        return finishWithReply(session, reply, "idle");
      }
      return finishWithReply(
        session,
        ASK_ORDER_EMAIL_REPLY,
        "awaiting_order_email",
        orderNumber,
      );
    }
    // Escape if they switched to something else (product / off-topic).
    if (
      isOffTopicQuery(lastUser) ||
      shouldForceProductSearch(lastUser) ||
      isAmbiguousBrowseQuery(lastUser) ||
      isDiscountQuery(lastUser) ||
      isDiscountCodeQuery(lastUser)
    ) {
      resetConversationState(session);
    } else {
      return finishWithReply(
        session,
        ASK_ORDER_NUMBER_CLARIFY_REPLY,
        "awaiting_order_number",
      );
    }
  }

  if (isOrderTrackingIntent(lastUser)) {
    setSessionIntent(session, "order_tracking");
    const embedded = extractOrderNumberFromText(lastUser);
    const email = extractEmailFromText(lastUser);
    const withoutIntent = stripOrderTrackingPhrases(lastUser);

    if (embedded && withoutIntent && isValidOrderNumberInput(withoutIntent)) {
      if (email) {
        const reply = await lookupOrderReply(embedded, email, {
          region,
          signal,
        });
        return finishWithReply(session, reply, "idle");
      }
      return finishWithReply(
        session,
        ASK_ORDER_EMAIL_REPLY,
        "awaiting_order_email",
        embedded,
      );
    }
    if (embedded && !withoutIntent) {
      // e.g. "track order 1001" where phrase strip left the number
      if (email) {
        const reply = await lookupOrderReply(embedded, email, {
          region,
          signal,
        });
        return finishWithReply(session, reply, "idle");
      }
      return finishWithReply(
        session,
        ASK_ORDER_EMAIL_REPLY,
        "awaiting_order_email",
        embedded,
      );
    }
    // Also accept "track this order 1001" where number remains after strip
    if (withoutIntent && isValidOrderNumberInput(withoutIntent)) {
      const orderNumber = normalizeOrderNumber(withoutIntent)!;
      if (email) {
        const reply = await lookupOrderReply(orderNumber, email, {
          region,
          signal,
        });
        return finishWithReply(session, reply, "idle");
      }
      return finishWithReply(
        session,
        ASK_ORDER_EMAIL_REPLY,
        "awaiting_order_email",
        orderNumber,
      );
    }
    return finishWithReply(
      session,
      ASK_ORDER_NUMBER_REPLY,
      "awaiting_order_number",
    );
  }

  // Bare order number (or "find/check 1001") → collect email for tracking
  const orderLookupToken = extractOrderLookupToken(lastUser);
  if (orderLookupToken) {
    setSessionIntent(session, "order_tracking");
    const email = extractEmailFromText(lastUser);
    if (email) {
      const reply = await lookupOrderReply(orderLookupToken, email, {
        region,
        signal,
      });
      return finishWithReply(session, reply, "idle");
    }
    return finishWithReply(
      session,
      `Got it — I'll look up order **${orderLookupToken}**. ${ASK_ORDER_EMAIL_REPLY}`,
      "awaiting_order_email",
      orderLookupToken,
    );
  }

  // Only short-circuit clear off-topic when there is no product thread to continue.
  if (
    isOffTopicQuery(lastUser) &&
    !isProductFollowUpQuery(lastUser) &&
    !hasRecentProductContext(history)
  ) {
    setSessionIntent(session, "off_topic");
    return finishWithReply(session, OFF_TOPIC_REPLY);
  }

  // Used only for the honest "no results" fallback below — the advisor decides
  // for itself whether to retrieve (no forced search).
  const productIntent =
    shouldForceProductSearch(lastUser) ||
    isDiscountQuery(lastUser) ||
    (isProductFollowUpQuery(lastUser) && hasRecentProductContext(history));

  setSessionIntent(session, resolveTurnIntent(lastUser, session));

  // Inject remembered products so the advisor can resolve "these/that/which one"
  // and do variant lookups by id before searching again.
  const contextBlock = buildContextBlock(session.lastShownProducts);
  const conversation: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(contextBlock ? [{ role: "system", content: contextBlock } as const] : []),
    ...history,
  ];

  let sawEmptyCatalog = false;
  let needsLargeListBudget = false;
  let capturedProducts: ShownProduct[] | null = null;

  /** Persist the reply and any freshly shown products for the next turn. */
  const finish = (
    reply: string,
    nextState: ConversationState = "idle",
    pendingOrderNumber: string | null = null,
  ): string => {
    if (capturedProducts && capturedProducts.length > 0) {
      setLastShownProducts(session, capturedProducts);
    }
    return finishWithReply(session, reply, nextState, pendingOrderNumber);
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal.aborted) {
      return finish(FALLBACK_REPLY);
    }

    const completion = await client.chat.completions.create(
      {
        model,
        messages: conversation,
        tools: tools,
        // The advisor decides whether to retrieve — never force a search.
        tool_choice: "auto",
        temperature: 0.3,
        max_tokens: needsLargeListBudget
          ? LARGE_LIST_COMPLETION_TOKENS
          : MAX_COMPLETION_TOKENS,
      },
      { signal },
    );

    if (completion.usage) {
      addTokenUsage(session, completion.usage);
      logger.info("chat-agent", "openai usage", {
        requestId,
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
        sessionPromptTokens: session.promptTokens,
        sessionCompletionTokens: session.completionTokens,
        sessionTotalTokens: session.totalTokens,
        intent: session.intent,
        model,
      });
    }

    const choice = completion.choices[0];
    const message = choice?.message;
    if (!message) break;

    if (choice.finish_reason === "content_filter") {
      return finish(CONTENT_FILTERED_REPLY);
    }

    const toolCalls = message.tool_calls?.filter(
      (tc) => tc.type === "function",
    );
    if (!toolCalls || toolCalls.length === 0) {
      let reply = stripAssistantMedia(message.content ?? "") || FALLBACK_REPLY;
      if (choice.finish_reason === "length") {
        reply = reply
          ? `${reply.trim()}\n\n_(List was cut short — ask me to continue or show the next set.)_`
          : "Here is a partial answer — ask me to continue if you need more detail.";
      }
      if (
        productIntent &&
        sawEmptyCatalog &&
        (/how can i assist|products and shopping|^product not available\.?$/i.test(
          reply,
        ) ||
          reply.length < 12)
      ) {
        return finish(NOT_AVAILABLE_REPLY);
      }
      return finish(reply);
    }

    conversation.push(message);
    for (const toolCall of toolCalls) {
      if (toolCall.type !== "function") continue;

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        // empty args
      }

      const result = await runTool(toolCall.function.name, args, {
        region,
        signal,
        lastUser,
      });

      if (toolCall.function.name === "track_order") {
        try {
          const parsed = JSON.parse(result) as {
            message?: string;
            error?: string;
          };
          if (parsed.message) {
            return finish(parsed.message, "idle");
          }
          if (parsed.error) {
            return finish(parsed.error, "idle");
          }
        } catch {
          // fall through
        }
      }

      if (CATALOG_TOOLS.has(toolCall.function.name)) {
        const dataSection = extractCatalogData(result);
        if (!dataSection || dataSection === "{}") {
          sawEmptyCatalog = true;
        } else {
          sawEmptyCatalog = false;
          if (dataSection.length > LARGE_PAYLOAD_CHARS) {
            needsLargeListBudget = true;
          }
          // Remember the latest non-empty set for follow-up/pronoun resolution.
          const shown = extractShownProducts(result);
          if (shown.length > 0) capturedProducts = shown;
        }
      }

      conversation.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return finish(
    productIntent && sawEmptyCatalog ? NOT_AVAILABLE_REPLY : FALLBACK_REPLY,
  );
}
