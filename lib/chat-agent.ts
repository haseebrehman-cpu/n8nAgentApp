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
  setCatalogContext,
  setConversationState,
  setLastSearchQuery,
  setLastShownProducts,
  setPendingCategory,
  setSessionIntent,
} from "@/lib/chat/session";
import {
  buildContextBlock,
  extractShownProducts,
  type ShownProduct,
} from "@/lib/chat/context/product-memory";
import { logger } from "@/lib/logger";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import type { ChatAgentResult, ChatAttachment, ChatMessagePayload } from "@/lib/types";
import type { RunChatAgentOptions } from "@/lib/chat/types";
import { polishCustomerReply } from "@/lib/chat/messaging/polish";
import {
  ADDRESS_CHANGE_REPLY,
  CONTACT_SUPPORT_REPLY,
  GOODBYE_REPLY,
  GREETING_REPLY,
  ORDER_CANCEL_REPLY,
  ORDER_MODIFY_REPLY,
  THANKS_REPLY,
} from "@/lib/chat/messaging/journey-replies";
import { resolveDeterministicTurn } from "@/lib/chat/agent/orchestrator";
import { messageContainsUrl } from "@/lib/chat/url";
import {
  extractEmailFromText,
  extractOrderLookupToken,
  extractOrderNumberFromText,
  hasRecentProductContext,
  isAmbiguousBrowseQuery,
  isDiscountCodeQuery,
  isDiscountQuery,
  isHarmfulQuery,
  isHumanEscalationRequest,
  isInventoryQuantityQuery,
  isOffTopicQuery,
  isOrderTrackingIntent,
  isProductFollowUpQuery,
  isPromptInjectionAttempt,
  journeyForcesCatalogSearch,
  needsProductClarification,
  resolveCustomerJourney,
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
  ORDER_TRACKING_ENABLED,
} from "@/lib/chat/agent/config";
import { tools } from "@/lib/chat/agent/tools";
import { combineDeadline, getClient } from "@/lib/chat/agent/openai-client";
import { runTool } from "@/lib/chat/agent/tool-runner";
import { lookupOrderReply } from "@/lib/chat/agent/order-lookup";
import { getOpenAIConfig, getShopifyConfig } from "@/lib/config";
import {
  isCatalogInfraFailure,
  isEmptyCatalogResult,
} from "@/lib/chat/search";
import { isSearchRefinement } from "@/lib/chat/search/query-rewrite";
import {
  ASK_ORDER_EMAIL_REPLY,
  ASK_ORDER_NUMBER_CLARIFY_REPLY,
  ASK_ORDER_NUMBER_REPLY,
  CONTENT_FILTERED_REPLY,
  DISCOUNT_CODE_REPLY,
  FALLBACK_REPLY,
  HARMFUL_QUERY_REPLY,
  HUMAN_ESCALATION_REPLY,
  INJECTION_REDIRECT_REPLY,
  NOT_AVAILABLE_REPLY,
  OFF_TOPIC_REPLY,
  ORDER_EMAIL_STILL_NEEDED_REPLY,
  ORDER_LOOKUP_FAILED_REPLY,
  ORDER_TRACKING_UNAVAILABLE_REPLY,
  SERVICE_UNAVAILABLE_REPLY,
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
  attachments?: ChatAttachment[],
): ChatAgentResult {
  const cleaned = polishCustomerReply(reply) || FALLBACK_REPLY;
  appendAssistantMessage(session, cleaned);
  if (nextState === "idle") {
    resetConversationState(session);
  } else {
    setConversationState(session, nextState, pendingOrderNumber);
  }
  return attachments?.length
    ? { reply: cleaned, attachments }
    : { reply: cleaned };
}

/**
 * Whether the first OpenAI round must call search_catalog before answering.
 * Keeps inventory/size-chart/clarification turns on tool_choice:auto.
 */
function round0ForceCatalogSearch(
  lastUser: string,
  productIntent: boolean,
  contextOnlyFollowUp: boolean,
): boolean {
  if (!productIntent) return false;
  if (contextOnlyFollowUp) return false;
  if (needsProductClarification(lastUser)) return false;
  if (isInventoryQuantityQuery(lastUser)) return false;
  if (/\b(size\s+chart|size\s+guide|sizing\s+chart)\b/i.test(lastUser)) {
    return false;
  }
  // Discount browse still needs catalog retrieval.
  if (isDiscountQuery(lastUser)) return true;
  // shouldForceProductSearch already includes clear category browse and
  // excludes ultra-broad clarify-first phrases ("boxing", "gloves", …).
  return shouldForceProductSearch(lastUser);
}

/** Stable intent labels persisted on the session / Mongo chat document. */
function resolveTurnIntent(lastUser: string, session: ChatSession): string {
  if (
    ORDER_TRACKING_ENABLED &&
    (session.state === "awaiting_order_email" ||
      session.state === "awaiting_order_number")
  ) {
    return "order_tracking";
  }
  if (isHumanEscalationRequest(lastUser)) return "human_support";
  if (
    ORDER_TRACKING_ENABLED &&
    (isOrderTrackingIntent(lastUser) || extractOrderLookupToken(lastUser))
  ) {
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
): Promise<ChatAgentResult> {
  const { session, region, requestId } = options;
  const signal = combineDeadline(options.signal, AGENT_WALL_CLOCK_MS);
  const client = getClient();
  const { model } = getOpenAIConfig();

  const lastUser =
    [...history].reverse().find((m) => m.role === "user")?.content ?? "";

  // Safety first: refuse dangerous/illegal requests before any tool routing.
  // "RDX" is our brand but also an explosive, so guard against misuse.
  if (isHarmfulQuery(lastUser)) {
    setSessionIntent(session, "off_topic");
    return finishWithReply(session, HARMFUL_QUERY_REPLY);
  }

  if (isPromptInjectionAttempt(lastUser)) {
    logger.warn("chat-agent", "prompt injection attempt blocked", {
      requestId,
    });
    setSessionIntent(session, "general");
    return finishWithReply(session, INJECTION_REDIRECT_REPLY);
  }

  if (isDiscountCodeQuery(lastUser)) {
    setSessionIntent(session, "discount_code");
    return finishWithReply(session, DISCOUNT_CODE_REPLY);
  }

  // Ecommerce journey short-circuits (social + post-purchase limits).
  const journey = resolveCustomerJourney(lastUser);
  if (journey?.kind === "greeting") {
    setSessionIntent(session, "general");
    return finishWithReply(session, GREETING_REPLY);
  }
  if (journey?.kind === "thanks") {
    setSessionIntent(session, "general");
    return finishWithReply(session, THANKS_REPLY);
  }
  if (journey?.kind === "goodbye") {
    setSessionIntent(session, "general");
    return finishWithReply(session, GOODBYE_REPLY);
  }
  if (journey?.kind === "order_cancel") {
    setSessionIntent(session, "order_support");
    return finishWithReply(session, ORDER_CANCEL_REPLY);
  }
  if (journey?.kind === "order_modify") {
    setSessionIntent(session, "order_support");
    return finishWithReply(session, ORDER_MODIFY_REPLY);
  }
  if (journey?.kind === "address_change") {
    setSessionIntent(session, "order_support");
    return finishWithReply(session, ADDRESS_CHANGE_REPLY);
  }
  if (journey?.kind === "contact_support") {
    setSessionIntent(session, "human_support");
    return finishWithReply(session, CONTACT_SUPPORT_REPLY);
  }

  // Human handoff: escalate immediately rather than looping the customer.
  if (isHumanEscalationRequest(lastUser)) {
    setSessionIntent(session, "human_support");
    return finishWithReply(session, HUMAN_ESCALATION_REPLY);
  }

  // TEMP: order tracking disabled — clear any mid-flow state and short-circuit.
  if (!ORDER_TRACKING_ENABLED) {
    const trackingAsk =
      session.state === "awaiting_order_email" ||
      session.state === "awaiting_order_number" ||
      isOrderTrackingIntent(lastUser) ||
      Boolean(extractOrderLookupToken(lastUser));
    if (
      session.state === "awaiting_order_email" ||
      session.state === "awaiting_order_number"
    ) {
      resetConversationState(session);
    }
    if (trackingAsk) {
      setSessionIntent(session, "order_tracking");
      return finishWithReply(session, ORDER_TRACKING_UNAVAILABLE_REPLY);
    }
  }

  // --- Explicit conversation state machine (not regex on assistant text) ---
  if (ORDER_TRACKING_ENABLED && session.state === "awaiting_order_email") {
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

  if (ORDER_TRACKING_ENABLED && session.state === "awaiting_order_number") {
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

  if (ORDER_TRACKING_ENABLED && isOrderTrackingIntent(lastUser)) {
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
  const orderLookupToken = ORDER_TRACKING_ENABLED
    ? extractOrderLookupToken(lastUser)
    : null;
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
  // Skip when the message includes a URL — RDX deep-links are handled next in
  // resolveDeterministicTurn (and non-RDX links get a dedicated reply there).
  if (
    !messageContainsUrl(lastUser) &&
    isOffTopicQuery(lastUser) &&
    !isProductFollowUpQuery(lastUser) &&
    !hasRecentProductContext(history)
  ) {
    setSessionIntent(session, "off_topic");
    return finishWithReply(session, OFF_TOPIC_REPLY);
  }

  const hasShown = Boolean(session.lastShownProducts?.length);

  // Deterministic catalog / care path: shortlists, dynamic clarify, care support.
  const deterministic = await resolveDeterministicTurn({
    lastUser,
    catalogContext: session.catalogContext,
    lastShownProducts: session.lastShownProducts,
    journey,
    signal,
  });

  if (deterministic.kind === "final_reply") {
    setSessionIntent(session, deterministic.intent);
    if (deterministic.pendingCategory !== undefined) {
      setPendingCategory(session, deterministic.pendingCategory);
    }
    if (deterministic.catalogContext !== undefined) {
      setCatalogContext(session, deterministic.catalogContext ?? null);
    }
    if (deterministic.shownProducts !== undefined) {
      setLastShownProducts(session, deterministic.shownProducts);
    }
    if (deterministic.searchQuery) {
      setLastSearchQuery(session, deterministic.searchQuery);
    }
    return finishWithReply(session, deterministic.reply);
  }

  const skipCatalogSearch =
    deterministic.kind === "llm_wrap" && deterministic.skipCatalogSearch;
  const orchestratorBlocks =
    deterministic.kind === "llm_wrap" ? deterministic.systemBlocks : [];
  const orchestratorFallback =
    deterministic.kind === "llm_wrap" ? deterministic.fallbackReply : undefined;

  if (deterministic.kind === "llm_wrap") {
    setSessionIntent(session, deterministic.intent);
    if (deterministic.pendingCategory !== undefined) {
      setPendingCategory(session, deterministic.pendingCategory);
    }
    if (deterministic.catalogContext !== undefined) {
      setCatalogContext(session, deterministic.catalogContext ?? null);
    }
    if (deterministic.shownProducts !== undefined) {
      setLastShownProducts(session, deterministic.shownProducts);
    }
    if (deterministic.searchQuery) {
      setLastSearchQuery(session, deterministic.searchQuery);
    }
  }

  // Used for the honest "no results" fallback and for forcing semantic search.
  const productIntent =
    shouldForceProductSearch(lastUser) ||
    isDiscountQuery(lastUser) ||
    (isProductFollowUpQuery(lastUser) && hasRecentProductContext(history));

  /**
   * Force search_catalog on the first tool round for clear product discovery.
   * Skip when the orchestrator already built a shortlist / care guidance.
   */
  const refinementNeedsTool =
    (isSearchRefinement(lastUser, session.lastSearchQuery) ||
      isProductFollowUpQuery(lastUser)) &&
    hasShown &&
    /\b(cheaper|cheapest|only\s+\w+|just\s+\w+|\d{1,2}\s*oz|blue|red|black|green|leather)\b/i.test(
      lastUser,
    );
  const contextOnlyFollowUp =
    isProductFollowUpQuery(lastUser) &&
    hasShown &&
    !refinementNeedsTool &&
    !shouldForceProductSearch(lastUser);
  const merchJourney =
    journey && journeyForcesCatalogSearch(journey.kind) ? journey : null;
  const forceCatalogSearch =
    !skipCatalogSearch &&
    (Boolean(merchJourney) ||
      refinementNeedsTool ||
      round0ForceCatalogSearch(
        lastUser,
        productIntent || Boolean(merchJourney),
        contextOnlyFollowUp,
      ));

  if (deterministic.kind !== "llm_wrap") {
    setSessionIntent(session, resolveTurnIntent(lastUser, session));
  }

  // Inject remembered products so the advisor can resolve "these/that/which one"
  // and do variant lookups by id before searching again.
  const contextBlock = buildContextBlock(session.lastShownProducts, {
    lastSearchQuery: session.lastSearchQuery,
    pendingCategory: session.pendingCategory,
  });
  const journeyHint =
    !skipCatalogSearch && merchJourney?.searchQuery
      ? (`JOURNEY HINT (trusted): Customer journey=${merchJourney.kind}. ` +
          `Call search_catalog with query="${merchJourney.searchQuery}"` +
          (merchJourney.budgetMax != null
            ? ` and respect budget under ${merchJourney.budgetMax}`
            : "") +
          (merchJourney.kind === "on_sale"
            ? "; prefer products that are on sale"
            : "") +
          (merchJourney.kind === "accessories" || merchJourney.kind === "fbt"
            ? ". Search related add-ons from the catalog"
            : "") +
          (merchJourney.kind === "alternatives"
            ? ". Find similar alternatives to what they named or last showed"
            : "") +
          ". Then reply naturally using the product facts.")
      : null;
  let marketHint: string | null = null;
  try {
    const { marketCountry } = getShopifyConfig();
    if (marketCountry) {
      marketHint = `STORE MARKET (trusted): Catalog prices and availability are for market country ${marketCountry}. Quote tool currencies as returned. Do not convert prices or invent stock for other regions. Request region hint: ${region ?? "default"}.`;
    }
  } catch {
    // Config may be incomplete in some environments — skip market hint.
  }
  const conversation: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(contextBlock ? [{ role: "system", content: contextBlock } as const] : []),
    ...orchestratorBlocks.map(
      (content) => ({ role: "system", content }) as const,
    ),
    ...(journeyHint
      ? [{ role: "system", content: journeyHint } as const]
      : []),
    ...(marketHint ? [{ role: "system", content: marketHint } as const] : []),
    ...history,
  ];

  let sawEmptyCatalog = false;
  let sawCatalogInfraFailure = false;
  let needsLargeListBudget = false;
  let capturedProducts: ShownProduct[] | null =
    deterministic.kind === "llm_wrap"
      ? deterministic.shownProducts ?? null
      : null;
  let capturedSizeChart: ChatAttachment | null = null;
  let capturedSearchQuery: string | null =
    deterministic.kind === "llm_wrap"
      ? deterministic.searchQuery ?? null
      : null;
  let catalogToolUsed = skipCatalogSearch;

  /** Persist the reply and any freshly shown products for the next turn. */
  const finish = (
    reply: string,
    nextState: ConversationState = "idle",
    pendingOrderNumber: string | null = null,
  ): ChatAgentResult => {
    if (capturedProducts && capturedProducts.length > 0) {
      setLastShownProducts(session, capturedProducts);
    }
    if (capturedSearchQuery) {
      setLastSearchQuery(session, capturedSearchQuery);
    }
    if (session.catalogContext || deterministic.kind === "llm_wrap") {
      // Keep frozen catalog context in sync with shown products.
      if (deterministic.kind === "llm_wrap" && deterministic.catalogContext) {
        setCatalogContext(session, deterministic.catalogContext);
      }
    }
    return finishWithReply(
      session,
      reply,
      nextState,
      pendingOrderNumber,
      capturedSizeChart ? [capturedSizeChart] : undefined,
    );
  };

  const applyCatalogToolResult = (result: string): void => {
    catalogToolUsed = true;
    if (isCatalogInfraFailure(result)) {
      sawCatalogInfraFailure = true;
      return;
    }
    if (isEmptyCatalogResult(result)) {
      sawEmptyCatalog = true;
      return;
    }
    sawEmptyCatalog = false;
    if (result.length > LARGE_PAYLOAD_CHARS) {
      needsLargeListBudget = true;
    }
    const shown = extractShownProducts(result);
    if (shown.length > 0) capturedProducts = shown;
  };

  const toolRunOpts = {
    region,
    signal,
    lastUser,
    lastSearchQuery: session.lastSearchQuery,
    lastShownProducts: session.lastShownProducts,
    onSearchQuery: (query: string) => {
      capturedSearchQuery = query;
    },
    onSizeChartAttachment: (attachment: ChatAttachment) => {
      capturedSizeChart = attachment;
    },
  };

  // Prefetch search_catalog when we already know it is required — skips a
  // wasted LLM round that only emits the forced tool call.
  if (forceCatalogSearch && !signal.aborted) {
    const prefetchArgs: Record<string, unknown> = {
      query: merchJourney?.searchQuery?.trim() || lastUser.trim(),
    };
    if (merchJourney?.budgetMax != null) {
      prefetchArgs.budgetMax = merchJourney.budgetMax;
    }
    if (merchJourney?.kind === "on_sale") {
      prefetchArgs.onSaleOnly = true;
    }

    const toolCallId = `prefetch_search_${Date.now()}`;
    const result = await runTool("search_catalog", prefetchArgs, toolRunOpts);
    applyCatalogToolResult(result);

    conversation.push({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: toolCallId,
          type: "function",
          function: {
            name: "search_catalog",
            arguments: JSON.stringify(prefetchArgs),
          },
        },
      ],
    });
    conversation.push({
      role: "tool",
      tool_call_id: toolCallId,
      content: result,
    });

    logger.info("chat-agent", "prefetched search_catalog", {
      requestId,
      infraFailure: sawCatalogInfraFailure,
      empty: sawEmptyCatalog,
    });

    // Honest short-circuit: don't ask the model to invent products after infra failure.
    if (sawCatalogInfraFailure) {
      return finish(SERVICE_UNAVAILABLE_REPLY);
    }
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal.aborted) {
      return finish(
        sawCatalogInfraFailure
          ? SERVICE_UNAVAILABLE_REPLY
          : productIntent && sawEmptyCatalog
            ? NOT_AVAILABLE_REPLY
            : FALLBACK_REPLY,
      );
    }

    // Only force search_catalog when prefetch did not already run.
    const toolChoice =
      forceCatalogSearch && round === 0 && !catalogToolUsed
        ? ({
            type: "function" as const,
            function: { name: "search_catalog" },
          } as const)
        : ("auto" as const);

    let completion;
    try {
      completion = await client.chat.completions.create(
        {
          model,
          messages: conversation,
          tools: tools,
          tool_choice: toolChoice,
          // gpt-5.6-terra rejects function tools unless reasoning is disabled
          // on /v1/chat/completions (or callers migrate to /v1/responses).
          reasoning_effort: "none",
          temperature: 0.3,
          max_completion_tokens: needsLargeListBudget
            ? LARGE_LIST_COMPLETION_TOKENS
            : MAX_COMPLETION_TOKENS,
        },
        { signal },
      );
    } catch (err) {
      if (signal.aborted) {
        return finish(orchestratorFallback || FALLBACK_REPLY);
      }
      logger.error("chat-agent", "openai completion failed", {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
      if (orchestratorFallback) {
        return finish(orchestratorFallback);
      }
      return finish(
        sawCatalogInfraFailure || productIntent
          ? SERVICE_UNAVAILABLE_REPLY
          : FALLBACK_REPLY,
      );
    }

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
      if (sawCatalogInfraFailure) {
        return finish(SERVICE_UNAVAILABLE_REPLY);
      }
      let reply =
        polishCustomerReply(message.content ?? "") ||
        orchestratorFallback ||
        FALLBACK_REPLY;
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
        return finish(orchestratorFallback || NOT_AVAILABLE_REPLY);
      }
      // Empty model content after a successful empty catalog → honest no-results.
      if (productIntent && sawEmptyCatalog && !reply.trim()) {
        return finish(orchestratorFallback || NOT_AVAILABLE_REPLY);
      }
      return finish(reply || orchestratorFallback || FALLBACK_REPLY);
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

      const result = await runTool(toolCall.function.name, args, toolRunOpts);

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
            // Prefer known customer-safe copy; never leak opaque infra strings.
            const err = parsed.error.trim();
            const safe =
              err.length > 0 &&
              err.length < 280 &&
              !/exception|stack|ECONN|ETIMEDOUT|fetch failed|500|401|403/i.test(
                err,
              )
                ? err
                : ORDER_LOOKUP_FAILED_REPLY;
            return finish(safe, "idle");  
          }
        } catch {
          // fall through
        }
      }

      if (CATALOG_TOOLS.has(toolCall.function.name)) {
        applyCatalogToolResult(result);
      }

      conversation.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  if (sawCatalogInfraFailure) {
    return finish(SERVICE_UNAVAILABLE_REPLY);
  }
  if (orchestratorFallback) {
    return finish(orchestratorFallback);
  }
  return finish(
    productIntent && sawEmptyCatalog ? NOT_AVAILABLE_REPLY : FALLBACK_REPLY,
  );
}
