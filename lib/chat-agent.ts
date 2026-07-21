/**
 * Conversational agent: OpenAI tool-calling loop backed by Shopify's hosted
 * Storefront MCP server (product search, product details, policies/FAQs) plus
 * order tracking. Lives inside Next.js — n8n is reserved for other automations.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import {
  formatOrderTrackingChatReply,
  isValidEmailInput,
  isValidOrderNumberInput,
  normalizeEmail,
  normalizeOrderNumber,
  OrderTrackingError,
  trackOrder,
} from "@/lib/chatbot/orderTracking";
import type { ChatSession, ConversationState } from "@/lib/chat/session";
import {
  addTokenUsage,
  appendAssistantMessage,
  resetConversationState,
  setConversationState,
  setSessionIntent,
} from "@/lib/chat/session";
import { getOpenAIConfig, isConfigError } from "@/lib/config";
import { logger } from "@/lib/logger";
import { stripAssistantMedia } from "@/lib/sanitize";
import {
  getProduct,
  lookupCatalog,
  searchCatalog,
  searchShopPoliciesAndFaqs,
} from "@/lib/shopify/storefront-mcp";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import type { ChatMessagePayload } from "@/lib/types";
import type { ShopifyStoreRegion } from "@/services/shopify/credentials";

const MAX_TOOL_ROUNDS = 6;
const OPENAI_TIMEOUT_MS = 45_000;
const AGENT_WALL_CLOCK_MS = 55_000;
const MAX_COMPLETION_TOKENS = 1_000;
/** Larger lists need more completion budget so we don't cut mid-list. */
const LARGE_LIST_COMPLETION_TOKENS = 4_000;
/** Tool payload size (chars) above which we assume a long list is coming back. */
const LARGE_PAYLOAD_CHARS = 1_500;
const SEARCH_RESULT_LIMIT = 10;

const FALLBACK_REPLY =
  "I'm sorry, I couldn't complete that request. Could you rephrase it or try again?";

const NOT_AVAILABLE_REPLY =
  "I'd be happy to help you find the right product. Could you tell me a bit more about what you're looking for — for example a category, size, or product name?";

const DISCOUNT_CODE_REPLY =
  "We don't share discount or coupon codes in chat. If you'd like, I can show you products that are currently on sale at a reduced price instead.";

const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "our store";

export const OFF_TOPIC_REPLY = `I'm here to help with ${STORE_NAME} — our products and shopping. How can I assist you today?`;

export const ASK_ORDER_NUMBER_REPLY =
  "Sure — I can help track that. What's your order number?";
export const ASK_ORDER_EMAIL_REPLY =
  "Thanks. What's the email address you used when you placed the order?";
export const ASK_ORDER_NUMBER_CLARIFY_REPLY =
  "Happy to help track that. Please share your order number (for example 1001, #1001, or OT-cbn4m39wmd).";

/** Phrases that mean the customer wants order tracking (not a product search). */
const ORDER_TRACKING_INTENT_RE =
  /\b(?:track(?:\s+(?:my|this|the|an|your))?\s+order|track\s+order|order\s+(?:track(?:ing)?|status)|where(?:'?s|\s+is)\s+my\s+(?:order|package|parcel|shipment)|check(?:\s+(?:my|this|the))?\s+(?:order|shipment|package|parcel)|track(?:\s+(?:my|this|the))?\s+(?:shipment|package|parcel)|track your order)\b/i;

/** Catalog tools whose (empty) results should drive the "no match" fallback. */
const CATALOG_TOOLS = new Set([
  "search_catalog",
  "get_product",
  "lookup_catalog",
]);

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_catalog",
      description:
        "Search the store's product catalog for items matching the customer's needs — by product name, type, category, feature, colour, size, price, or whether they're on sale. Use this for product discovery, browsing, listing, category questions, and finding a specific product. Prefer concise queries (e.g. 'boxing gloves', 'sauna suit', 'products on sale'). Do NOT use this for policy, shipping, or order-tracking questions.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'Free-text search query, e.g. "boxing gloves", "kids punch bag", "products on sale".',
          },
          limit: {
            type: "number",
            description: "Optional max number of products to return (caps at 50).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product",
      description:
        "Get full details for ONE specific product the customer has chosen, using a product id from a prior search_catalog or lookup_catalog result. Use when they want more detail, variants, sizes/colours, availability, or a link for a specific product.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Product id (e.g. gid://shopify/Product/123) taken from a prior tool result.",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_catalog",
      description:
        "Look up one or more products or variants by their known ids (e.g. gid://shopify/Product/123 or gid://shopify/ProductVariant/456) from prior tool results. Use to re-check specific items you already have ids for. Do NOT use for free-text search — use search_catalog instead.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description:
              "Up to 10 product or variant ids taken from prior tool results.",
          },
        },
        required: ["ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_shop_policies_and_faqs",
      description:
        "Answer questions about the store's policies and FAQs — shipping, delivery, returns, refunds, exchanges, warranty, payment, order changes, store hours, and how the store works. Use for any non-product informational question. Do NOT use for product catalog searches or order tracking.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The customer's policy or FAQ question.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "track_order",
      description:
        "Look up shipping status. Requires orderNumber AND the checkout email.",
      parameters: {
        type: "object",
        properties: {
          orderNumber: {
            type: "string",
            description: "Order number or name (e.g. 1001, #1001, OT-cbn4m39wmd).",
          },
          email: {
            type: "string",
            description: "Email used when placing the order.",
          },
        },
        required: ["orderNumber", "email"],
      },
    },
  },
];

export interface RunChatAgentOptions {
  session: ChatSession;
  signal?: AbortSignal;
  region?: ShopifyStoreRegion;
  requestId?: string;
}

/**
 * Wrap MCP tool output as untrusted CATALOG_DATA for the model, followed by a
 * trusted usage hint. The MCP server already returns storefront-ready facts
 * (titles, prices, availability, links, policy answers).
 */
function wrapMcpResult(data: string, hint: string): string {
  const trimmed = data?.trim() ?? "";
  return `<CATALOG_DATA>\n${trimmed || "{}"}\n</CATALOG_DATA>\n\n${hint}`;
}

/** Pull the untrusted data section back out of a wrapped tool result. */
function extractCatalogData(toolResult: string): string {
  const match = toolResult.match(
    /<CATALOG_DATA>\n?([\s\S]*?)\n?<\/CATALOG_DATA>/
  );
  return match ? match[1]!.trim() : "";
}

export function isDiscountCodeQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(discount\s*codes?|promo\s*codes?|promocodes?|coupon\s*codes?|coupons?|vouchers?|gift\s*codes?)\b/i.test(
      t
    ) ||
    (/\b(codes?)\b/i.test(t) &&
      /\b(discount|promo|promotional|coupon|voucher)\b/i.test(t))
  );
}

/** General sale/discount phrasing (not a code request). */
function isDiscountQuery(text: string): boolean {
  if (isDiscountCodeQuery(text)) return false;
  return /\b(discount|discounts|discounted|sale|sales|on\s+sale|offer|offers|deal|deals|reduced|clearance|promo|promotion|promotions|bargain|markdown)\b/i.test(
    text
  );
}

export function isOrderTrackingIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/^track your order$/i.test(t)) return true;
  return ORDER_TRACKING_INTENT_RE.test(t);
}

/** Bare token that looks like an order number (e.g. 1001, #1001, OT-xxx) — not a sentence. */
export function isBareOrderNumberToken(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  return isValidOrderNumberInput(t);
}

/**
 * Follow-ups that refer to products already in the conversation
 * ("difference between the two", "which size", "what about the black one").
 */
export function isProductFollowUpQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  if (
    /\b(difference|different|differ|compare|comparison|versus|vs\.?|which\s+(one|is|are|should|glove|product|size|colour|color)|better(?:\s+for)?|between\s+(the\s+)?(two|them|these|those)|(?:the|these|those)\s+two|both(?:\s+of\s+them)?|first\s+one|second\s+one|that\s+one|this\s+one|the\s+other(?:\s+one)?|same\s+as|similar)\b/i.test(
      t
    )
  ) {
    return true;
  }

  if (
    /^(and|also|what about|how about|same for|same question|and the)\b/i.test(t)
  ) {
    return true;
  }

  // Pronoun / size follow-ups tied to prior product turns
  if (
    /\b(them|these|those|it|that|this|ones?)\b/i.test(t) &&
    /\b(oz|ounce|size|colour|color|stock|price|cheaper|expensive|heavier|lighter|options?|available)\b/i.test(
      t
    )
  ) {
    return true;
  }

  return false;
}

/** Recent turns look like product Q&A — keep follow-ups with the LLM. */
export function hasRecentProductContext(
  history: ChatMessagePayload[],
  lookback = 6
): boolean {
  const recent = history.slice(-lookback);
  return recent.some((m) => {
    if (m.role !== "assistant" && m.role !== "user") return false;
    const c = m.content;
    return (
      /\*\*Price:\*\*/i.test(c) ||
      /\*\*Key features\*\*/i.test(c) ||
      /View product:/i.test(c) ||
      /Found \*\*\d+\*\* products/i.test(c) ||
      /\b(RDX|gloves|guard|kit|bundle|boxing|mma|shin|robe)\b/i.test(c)
    );
  });
}

/**
 * Clearly non-shopping questions (trivia, homework, etc.).
 * Kept narrow so real product questions and follow-ups are never blocked.
 */
export function isOffTopicQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (isOrderTrackingIntent(t) || isDiscountCodeQuery(t) || isDiscountQuery(t)) {
    return false;
  }
  if (isProductFollowUpQuery(t)) return false;
  if (isBareOrderNumberToken(t) || isValidEmailInput(t)) return false;

  // Geography / trivia / general knowledge
  if (
    /\b(capital\s+of|who\s+is|who\s+was|when\s+was|when\s+did|what\s+is\s+the\s+capital|president\s+of|prime\s+minister)\b/i.test(
      t
    )
  ) {
    return true;
  }

  // Homework / coding / essays — not shopping
  if (
    /\b(write\s+(me\s+)?(an?\s+)?(essay|poem|story|code|script)|solve\s+this|homework|calculate|translate\s+this)\b/i.test(
      t
    )
  ) {
    return true;
  }

  // Standalone trivia-style "what is X" — not product follow-ups or shopping terms
  if (
    /^(what(?:'s|\s+is)|who(?:'s|\s+is)|where(?:'s|\s+is)|when(?:'s|\s+is)|why(?:'s|\s+is)|how\s+(?:do|does|did|can|many|much)\b)/i.test(
      t
    ) &&
    !/\b(product|price|cost|size|stock|colour|color|order|shipping|delivery|discount|sale|buy|gloves|guard|kit|bundle|boxing|mma|store|available|difference|different|compare|versus|\bvs\b|better|which|policy|policies|return|refund)\b/i.test(
      t
    )
  ) {
    return true;
  }

  return false;
}

function extractOrderNumberFromText(text: string): string | null {
  return normalizeOrderNumber(text);
}

function extractEmailFromText(text: string): string | null {
  const match = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  if (!match) return null;
  return normalizeEmail(match[0]);
}

function stripOrderTrackingPhrases(text: string): string {
  return text.replace(ORDER_TRACKING_INTENT_RE, "").trim();
}

/**
 * Idle-state order lookup tokens: bare "1001" / "#1001" / "OT-xxx",
 * or short "find/check/order 1001" (not product phrases).
 */
export function extractOrderLookupToken(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (isBareOrderNumberToken(t)) return normalizeOrderNumber(t);

  const prefixed = t.match(
    /^(?:find|search|check|lookup|look\s+up|order(?:\s*(?:number|no\.?|#))?)\s+[#:]?\s*([A-Za-z0-9][\w.-]{0,39})$/i
  );
  if (prefixed?.[1] && isBareOrderNumberToken(prefixed[1])) {
    return normalizeOrderNumber(prefixed[1]);
  }
  return null;
}

async function lookupOrderReply(
  orderNumber: string,
  email: string,
  options: { region?: ShopifyStoreRegion; signal?: AbortSignal }
): Promise<string> {
  try {
    const result = await trackOrder(orderNumber, {
      email,
      region: options.region,
      signal: options.signal,
    });
    return formatOrderTrackingChatReply(result);
  } catch (err) {
    if (err instanceof OrderTrackingError) return err.message;
    if (isConfigError(err)) {
      return "Order tracking is temporarily unavailable. Please try again later.";
    }
    logger.error("chat-agent", "track_order failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "We couldn't look up that order right now. Please try again shortly.";
  }
}

/** Message clearly looks like a product / shopping request. */
export function shouldForceProductSearch(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  if (isDiscountCodeQuery(t)) return false;
  if (isOrderTrackingIntent(t)) return false;
  if (isOffTopicQuery(t)) return false;
  if (isBareOrderNumberToken(t)) return false;
  if (isValidEmailInput(t)) return false;

  if (
    /^(hi|hello|hey|good\s+(morning|afternoon|evening)|thanks|thank you|ok|okay|bye)\b/.test(
      t
    ) &&
    t.length < 40
  ) {
    return false;
  }

  if (t === "product information") return false;

  // Pure policy / shipping / store-info questions belong to the policies tool.
  if (
    /\b(ship|shipping|delivery|hours?|opening|return|refund|damaged|place\s+(an\s+)?order|policy|policies)\b/.test(
      t
    ) &&
    !/\b(product|price|size|stock|colour|color|available|gloves|guard|kit|bundle)\b/.test(
      t
    )
  ) {
    return false;
  }

  // Explicit product / shopping signals.
  if (
    /\b(price|cost|how much|in stock|available|size|colour|color|variant|buy|link|url|product|products|gloves|guard|shoes|kit|bundle|shin|boxing|mma|robe|looking\s+for|do\s+you\s+(?:have|sell)|show\s+me)\b/i.test(
      t
    )
  ) {
    return true;
  }

  // "find/search X" is product search unless X is only an order-like token.
  if (/^(find|search|show|looking\s+for)\b/i.test(t)) {
    const rest = t.replace(/^(find|search|show|looking\s+for)\s+/i, "").trim();
    if (rest && isBareOrderNumberToken(rest)) return false;
    return Boolean(rest);
  }

  // Short catalog-style phrases ("robo kids punch") — not questions or commands.
  const words = t.split(/\s+/).filter(Boolean);
  if (
    words.length >= 2 &&
    words.length <= 6 &&
    !/[?]/.test(t) &&
    !/^(what|who|where|when|why|how|is|are|can|could|would|should|do|does|did|please|tell|track|check|order|help|i|we|my|me)\b/i.test(
      t
    )
  ) {
    return true;
  }

  return false;
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  options: { region?: ShopifyStoreRegion; signal?: AbortSignal }
): Promise<string> {
  try {
    if (name === "search_catalog") {
      const query = String(args.query ?? "").trim();
      if (!query) return JSON.stringify({ error: "query is required" });

      const limitRaw = Number(args.limit);
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.min(Math.floor(limitRaw), 50)
          : SEARCH_RESULT_LIMIT;

      const data = await searchCatalog(
        { query, pagination: { limit } },
        { signal: options.signal }
      );
      return wrapMcpResult(
        data,
        "These are live catalog search results from the store. Use ONLY these products, prices, stock, and links — never invent items. If it is empty, do not give a blunt 'not found': ask a natural clarifying question or offer related options, and you may retry with different keywords. When listing many products, include every one returned."
      );
    }

    if (name === "get_product") {
      const id = String(args.id ?? "").trim();
      if (!id) return JSON.stringify({ error: "id is required" });

      const data = await getProduct({ id }, { signal: options.signal });
      return wrapMcpResult(
        data,
        "Full details for this product. Use ONLY these facts (price, variants, availability, link). Never invent details."
      );
    }

    if (name === "lookup_catalog") {
      const ids = Array.isArray(args.ids)
        ? args.ids.map((x) => String(x).trim()).filter(Boolean)
        : [];
      if (ids.length === 0) return JSON.stringify({ error: "ids is required" });

      const data = await lookupCatalog({ ids }, { signal: options.signal });
      return wrapMcpResult(
        data,
        "Products/variants resolved by id. Use ONLY these facts. Never invent details."
      );
    }

    if (name === "search_shop_policies_and_faqs") {
      const query = String(args.query ?? "").trim();
      if (!query) return JSON.stringify({ error: "query is required" });

      const data = await searchShopPoliciesAndFaqs(
        { query },
        { signal: options.signal }
      );
      return wrapMcpResult(
        data,
        "Store policy / FAQ answer. Answer the customer using ONLY this content — do not add outside information. If it does not clearly answer the question, say you're not certain and offer to help another way (e.g. order tracking)."
      );
    }

    if (name === "track_order") {
      const orderNumber = String(args.orderNumber ?? "").trim();
      const email = String(args.email ?? "").trim();
      if (!orderNumber) {
        return JSON.stringify({ error: "orderNumber is required" });
      }
      if (!email) {
        return JSON.stringify({ error: "email is required" });
      }
      const result = await trackOrder(orderNumber, {
        email,
        region: options.region,
        signal: options.signal,
      });
      return JSON.stringify({
        ...result,
        hint: "Reply to the customer using the message field. Do not invent tracking details.",
      });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err) {
    if (err instanceof OrderTrackingError) {
      return JSON.stringify({ error: err.message });
    }
    if (isConfigError(err)) {
      logger.error("chat-agent", `tool "${name}" config error`, {
        error: err.message,
      });
      return JSON.stringify({
        error:
          "The store connection is not ready yet. Apologize and say the service is temporarily unavailable.",
      });
    }
    logger.error("chat-agent", `tool "${name}" failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return JSON.stringify({
      error: "The lookup failed. Apologize and ask the customer to try again shortly.",
    });
  }
}

let cachedClient: OpenAI | null = null;
let cachedApiKey: string | null = null;

function getClient(): OpenAI {
  const { apiKey } = getOpenAIConfig();
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new OpenAI({
      apiKey,
      timeout: OPENAI_TIMEOUT_MS,
      maxRetries: 2,
    });
    cachedApiKey = apiKey;
  }
  return cachedClient;
}

function combineDeadline(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeout]);
  }
  return signal.aborted ? signal : timeout;
}

function finishWithReply(
  session: ChatSession,
  reply: string,
  nextState: ConversationState = "idle",
  pendingOrderNumber: string | null = null
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
  if (isOrderTrackingIntent(lastUser) || extractOrderLookupToken(lastUser)) {
    return "order_tracking";
  }
  if (isDiscountCodeQuery(lastUser)) return "discount_code";
  if (
    shouldForceProductSearch(lastUser) ||
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
  options: RunChatAgentOptions
): Promise<string> {
  const { session, region, requestId } = options;
  const signal = combineDeadline(options.signal, AGENT_WALL_CLOCK_MS);
  const client = getClient();
  const { model } = getOpenAIConfig();

  const lastUser =
    [...history].reverse().find((m) => m.role === "user")?.content ?? "";

  if (isDiscountCodeQuery(lastUser)) {
    setSessionIntent(session, "discount_code");
    return finishWithReply(session, DISCOUNT_CODE_REPLY);
  }

  // --- Explicit conversation state machine (not regex on assistant text) ---
  if (session.state === "awaiting_order_email") {
    setSessionIntent(session, "order_tracking");
    const email = extractEmailFromText(lastUser) ?? normalizeEmail(lastUser);
    const orderNumber = session.pendingOrderNumber;
    if (email && orderNumber) {
      const reply = await lookupOrderReply(orderNumber, email, { region, signal });
      return finishWithReply(session, reply, "idle");
    }
    // Customer changed topic (product question, off-topic, etc.) — leave tracking flow.
    if (!extractEmailFromText(lastUser) && !isValidEmailInput(lastUser)) {
      resetConversationState(session);
    } else {
      return finishWithReply(
        session,
        "I still need the email address you used when placing the order — for example name@email.com.",
        "awaiting_order_email",
        orderNumber
      );
    }
  }

  if (session.state === "awaiting_order_number") {
    setSessionIntent(session, "order_tracking");
    if (isValidOrderNumberInput(lastUser)) {
      const orderNumber = normalizeOrderNumber(lastUser)!;
      const email = extractEmailFromText(lastUser);
      if (email) {
        const reply = await lookupOrderReply(orderNumber, email, { region, signal });
        return finishWithReply(session, reply, "idle");
      }
      return finishWithReply(
        session,
        ASK_ORDER_EMAIL_REPLY,
        "awaiting_order_email",
        orderNumber
      );
    }
    // Escape if they switched to something else (product / off-topic).
    if (
      isOffTopicQuery(lastUser) ||
      shouldForceProductSearch(lastUser) ||
      isDiscountQuery(lastUser) ||
      isDiscountCodeQuery(lastUser)
    ) {
      resetConversationState(session);
    } else {
      return finishWithReply(
        session,
        ASK_ORDER_NUMBER_CLARIFY_REPLY,
        "awaiting_order_number"
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
        const reply = await lookupOrderReply(embedded, email, { region, signal });
        return finishWithReply(session, reply, "idle");
      }
      return finishWithReply(
        session,
        ASK_ORDER_EMAIL_REPLY,
        "awaiting_order_email",
        embedded
      );
    }
    if (embedded && !withoutIntent) {
      // e.g. "track order 1001" where phrase strip left the number
      if (email) {
        const reply = await lookupOrderReply(embedded, email, { region, signal });
        return finishWithReply(session, reply, "idle");
      }
      return finishWithReply(
        session,
        ASK_ORDER_EMAIL_REPLY,
        "awaiting_order_email",
        embedded
      );
    }
    // Also accept "track this order 1001" where number remains after strip
    if (withoutIntent && isValidOrderNumberInput(withoutIntent)) {
      const orderNumber = normalizeOrderNumber(withoutIntent)!;
      if (email) {
        const reply = await lookupOrderReply(orderNumber, email, { region, signal });
        return finishWithReply(session, reply, "idle");
      }
      return finishWithReply(
        session,
        ASK_ORDER_EMAIL_REPLY,
        "awaiting_order_email",
        orderNumber
      );
    }
    return finishWithReply(session, ASK_ORDER_NUMBER_REPLY, "awaiting_order_number");
  }

  // Bare order number (or "find/check 1001") → collect email for tracking
  const orderLookupToken = extractOrderLookupToken(lastUser);
  if (orderLookupToken) {
    setSessionIntent(session, "order_tracking");
    const email = extractEmailFromText(lastUser);
    if (email) {
      const reply = await lookupOrderReply(orderLookupToken, email, { region, signal });
      return finishWithReply(session, reply, "idle");
    }
    return finishWithReply(
      session,
      `Got it — I'll look up order **${orderLookupToken}**. ${ASK_ORDER_EMAIL_REPLY}`,
      "awaiting_order_email",
      orderLookupToken
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

  const productIntent =
    shouldForceProductSearch(lastUser) ||
    isDiscountQuery(lastUser) ||
    (isProductFollowUpQuery(lastUser) && hasRecentProductContext(history));

  setSessionIntent(session, resolveTurnIntent(lastUser, session));

  const conversation: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  let sawEmptyCatalog = false;
  let needsLargeListBudget = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal.aborted) {
      return finishWithReply(session, FALLBACK_REPLY);
    }

    const completion = await client.chat.completions.create(
      {
        model,
        messages: conversation,
        tools,
        tool_choice: "auto",
        temperature: 0.3,
        max_tokens: needsLargeListBudget
          ? LARGE_LIST_COMPLETION_TOKENS
          : MAX_COMPLETION_TOKENS,
      },
      { signal }
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
      return finishWithReply(
        session,
        "I couldn't complete that reply. Please try rephrasing your question."
      );
    }

    const toolCalls = message.tool_calls?.filter((tc) => tc.type === "function");
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
          reply
        ) ||
          reply.length < 12)
      ) {
        return finishWithReply(session, NOT_AVAILABLE_REPLY);
      }
      return finishWithReply(session, reply);
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

      const result = await runTool(toolCall.function.name, args, { region, signal });

      if (toolCall.function.name === "track_order") {
        try {
          const parsed = JSON.parse(result) as { message?: string; error?: string };
          if (parsed.message) {
            return finishWithReply(session, parsed.message, "idle");
          }
          if (parsed.error) {
            return finishWithReply(session, parsed.error, "idle");
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
        }
      }

      conversation.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return finishWithReply(
    session,
    productIntent && sawEmptyCatalog ? NOT_AVAILABLE_REPLY : FALLBACK_REPLY
  );
}
