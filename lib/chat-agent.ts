/**
 * Conversational agent: OpenAI tool-calling loop with Shopify product search
 * and order tracking. Lives inside Next.js — n8n is reserved for other automations.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import { toCompactToolProduct, toToolProduct, prioritizeInStock, wrapToolData } from "@/lib/catalog/tool-payload";
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
  setPendingCategory,
  setSessionIntent,
} from "@/lib/chat/session";
import { getOpenAIConfig, isConfigError } from "@/lib/config";
import { logger } from "@/lib/logger";
import { stripAssistantMedia } from "@/lib/sanitize";
import {
  countStorefrontProducts,
  estimateCategoryProductCount,
  getDiscountedProducts,
  lookupCategory,
  searchProducts,
} from "@/lib/shopify";
import {
  isKnownBrowsePhrase,
  normalizeBrowsePhrase,
} from "@/lib/shopify/static-menu";
import {
  countLeafSubcategories,
  findTaxonomyNode,
  getStoreTaxonomy,
  type TaxonomyNode,
} from "@/lib/shopify/taxonomy";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import type { ChatMessagePayload } from "@/lib/types";
import type { ShopifyStoreRegion } from "@/services/shopify/credentials";

const MAX_TOOL_ROUNDS = 6;
const OPENAI_TIMEOUT_MS = 45_000;
const AGENT_WALL_CLOCK_MS = 55_000;
const MAX_COMPLETION_TOKENS = 1_000;
/** Larger lists need more completion budget so we don't cut mid-list. */
const LARGE_LIST_COMPLETION_TOKENS = 4_000;
const LARGE_LIST_THRESHOLD = 8;
const SEARCH_RESULT_LIMIT = 5;
const DISCOUNT_RESULT_LIMIT = 8;
const CATEGORY_SAMPLE_LIMIT = 12;
const CATEGORY_LIST_MAX = 25;

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
const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the store catalog. Use for product name, model, price, size, colour, stock, or product-link questions. Prefer 2–4 distinctive words. Do NOT use this to answer how many products are in the whole store.",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description:
              'Search keywords, ideally 2–4 words. E.g. "robo kids punch", "boxing gloves".',
          },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_products",
      description:
        "Return the total number of products in the store catalog across all categories. Use when the customer asks how many products we have in total/overall/in the whole catalog — not for a specific category or product search.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_category",
      description:
        "Look up a store category/collection (e.g. yoga, boxing, strength training). Use for category counts or lists when the customer explicitly wants products listed or counted. Also use for follow-ups like \"list the ones in stock\" when continuing a prior category. Prefer browse_categories first for short ambiguous terms (boxing, gloves, mma) so you can ask clarifying questions.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: 'Category or collection name, e.g. "yoga", "boxing gloves", "strength training".',
          },
          mode: {
            type: "string",
            enum: ["count", "list"],
            description:
              'Use "count" when they ask how many / the count. Use "list" when they want to browse products in that category.',
          },
          inStockOnly: {
            type: "boolean",
            description:
              "When true, only return products that are in stock / available for sale.",
          },
          limit: {
            type: "number",
            description:
              "Optional max products to return in list mode (e.g. 20 when they ask to list 20). Caps at 25.",
          },
        },
        required: ["category", "mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browse_categories",
      description:
        'Get the store\'s category tree (main categories like Boxing, MMA, Fitness, Yoga, Apparel, Kids and their subcategories). Use when the customer asks what categories/subcategories exist, how many categories there are, what\'s inside a category, OR sends a short ambiguous browse term (e.g. "boxing", "gloves", "mma", "apparel") so you can offer natural follow-up options. NOT for dumping full product lists — use lookup_category when they explicitly ask to list/show N products.',
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description:
              'Optional: a category name to zoom into (e.g. "boxing"). Omit to get the full top-level category list.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_discounted_products",
      description:
        "List products currently on sale. Use ONLY for sale/discounted products — NOT for discount codes.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
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

function isDiscountCodeQuery(text: string): boolean {
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

export function isCategoryFollowUpQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  // Pronoun follow-ups ("list the ones in stock") — not a newly named category.
  if (
    /\b(list|show|browse)\s+(?:me\s+)?(?:all\s+|the\s+)?(ones?|them|these|those)\b/i.test(
      t
    ) ||
    (/\b(the\s+ones?|them|these|those)\b/i.test(t) &&
      /\b(in\s+stock|available|list|show)\b/i.test(t)) ||
    /\bwhich\s+(ones?\s+)?(are\s+)?(in\s+stock|available)\b/i.test(t) ||
    /^(list|show)\s+them\b/i.test(t)
  ) {
    // "list these products in belt" names a category — not a follow-up.
    if (
      /\b(?:ones?|them|these|those)\s+(?:products?\s+)?in\s+(?:the\s+)?(?!stock\b)[a-z0-9]/i.test(
        t
      ) ||
      /\bproducts?\s+in\s+(?:the\s+)?(?!stock\b)[a-z0-9]/i.test(t)
    ) {
      return false;
    }
    return true;
  }
  return false;
}

export function wantsInStockOnly(text: string): boolean {
  return /\b(in\s+stock|available\s+now|currently\s+available|only\s+available)\b/i.test(
    text.trim()
  );
}

/** Recover last category from prior user turns or assistant category replies. */
export function extractLastCategoryFromHistory(
  history: ChatMessagePayload[]
): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role === "user") {
      const intent = extractCategoryIntent(m.content);
      if (intent?.category) return intent.category;
    }
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role !== "assistant") continue;
    const match =
      m.content.match(
        /\b(?:there are|found)\s+\*?\*?\d+\*?\*?\s+products?\s+in\s+the\s+\*?\*?(.+?)\*?\*?\s+category\b/i
      ) ||
      m.content.match(/\bin\s+the\s+\*?\*?(.+?)\*?\*?\s+category\b/i);
    if (match?.[1]) {
      const cleaned = cleanCategoryName(match[1]);
      if (cleaned) return cleaned;
    }
  }
  return null;
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
 * Keep narrow so real product questions and follow-ups are never blocked.
 */
/**
 * Customer wants the whole-catalog product total (not a category search).
 * E.g. "how many products do we have", "overall across all categories".
 */
export function isCatalogCountQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  // A named category takes priority over whole-catalog count.
  if (extractCategoryIntent(t)) return false;

  // Clarifications that mean the whole catalog, not a prior category.
  if (
    /\b(all\s+categor(?:y|ies)|across\s+all(?:\s+categor(?:y|ies))?|entire\s+catalog|whole\s+catalog|whole\s+store)\b/i.test(
      t
    )
  ) {
    return true;
  }

  // Narrow category ("how many boxing gloves") stays on product search unless
  // they also ask for a store-wide total/overall.
  if (
    /\b(boxing|gloves|shin|guards?|kits?|bundles?|mma|robes?|shoes|wraps?|punch|bags?)\b/i.test(
      t
    ) &&
    !/\b(total|overall|altogether|all\s+categor|across\s+all|entire|whole)\b/i.test(
      t
    )
  ) {
    return false;
  }

  return (
    /\bhow\s+many\s+(total\s+)?products?\b/i.test(t) ||
    /\btotal\s+(number\s+of\s+)?products?\b/i.test(t) ||
    /\boverall[,:]?\s+(how\s+many\s+)?products?\b/i.test(t) ||
    /\b(how\s+many|total)\s+products?\s+(do\s+(we|you)\s+have|are\s+there|in\s+(the\s+)?(store|catalog))\b/i.test(
      t
    ) ||
    /\bproducts?\s+(do\s+(we|you)\s+have|in\s+(the\s+)?(catalog|store))\b/i.test(
      t
    )
  );
}

export interface CategoryStructureIntent {
  /** Category to zoom into (subcategories of X), or null for the full top-level list. */
  category: string | null;
}

/**
 * Questions about the category tree itself — "what categories do you have",
 * "how many categories", "what subcategories are in boxing" — as opposed to
 * products within a category (extractCategoryIntent).
 */
export function extractCategoryStructureIntent(
  text: string
): CategoryStructureIntent | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (!/\bcategor(?:y|ies)\b|\bsub[-\s]?categor/i.test(t)) return null;

  // Subcategory questions are always about structure.
  if (/\bsub[-\s]?categor/i.test(t)) {
    let category: string | null = null;

    // "what subcategories does boxing have"
    const doesHave = t.match(
      /\bsub[-\s]?categor(?:y|ies)\s+does\s+([a-z0-9][\w\s&-]{1,40}?)\s+have\b/i
    );
    if (doesHave?.[1]) category = cleanCategoryName(doesHave[1]);

    // "subcategories in/of/under boxing"
    if (!category) {
      const sub = t.match(
        /\bsub[-\s]?categor(?:y|ies)\b(?:\s+(?:are\s+there\s+|do\s+(?:we|you)\s+have\s+)?(?:of|in|under|for|inside)\s+(?:the\s+)?([a-z0-9][\w\s&-]{1,40}?))?\s*\??$/i
      );
      if (sub?.[1]) category = cleanCategoryName(sub[1]);
    }

    if (!category) {
      // "boxing subcategories" / "boxing's subcategories"
      const before = t.match(
        /\b([a-z0-9][\w\s&-]{1,40}?)(?:'s)?\s+sub[-\s]?categor(?:y|ies)\b/i
      );
      if (before?.[1]) {
        const cleaned = cleanCategoryName(before[1]);
        // Ignore leading interrogatives ("what subcategories…")
        if (
          cleaned &&
          !/^(what|which|how|many|are|there|does|do|we|you)$/i.test(cleaned)
        ) {
          category = cleaned;
        }
      }
    }
    return { category };
  }

  // Asking for products/items within a category is NOT a structure question.
  if (/\bproducts?\b|\bitems?\b/i.test(t)) return null;

  const asksAboutCategories =
    /\bhow\s+many\s+(?:main\s+|top[-\s]?level\s+)?categor(?:y|ies)\b/i.test(t) ||
    /\b(?:what|which)\s+(?:main\s+|top[-\s]?level\s+|all\s+)?categor(?:y|ies)\b/i.test(
      t
    ) ||
    /\b(?:list|show|name|tell|give)\b[\w\s,]*\bcategor(?:y|ies)\b/i.test(t) ||
    /\bcategor(?:y|ies)\s+(?:do\s+(?:we|you)\s+have|are\s+there|available|you\s+offer|we\s+offer|in\s+(?:the\s+)?store)\b/i.test(
      t
    ) ||
    /^(?:all\s+)?categor(?:y|ies)\s*\??$/i.test(t);

  if (!asksAboutCategories) return null;

  // Zoom target: "categories in boxing" / "categories under fitness" /
  // "what categories are in fitness".
  const zoom =
    t.match(
      /\bcategor(?:y|ies)\s+are\s+(?:there\s+)?(?:of|in|under|inside|within)\s+(?:the\s+)?([a-z0-9][\w\s&-]{1,40}?)\s*\??$/i
    ) ||
    t.match(
      /\bcategor(?:y|ies)\b\s+(?:are\s+there\s+|do\s+(?:we|you)\s+have\s+)?(?:of|in|under|inside|within)\s+(?:the\s+)?([a-z0-9][\w\s&-]{1,40}?)\s*\??$/i
    );
  const category = zoom?.[1] ? cleanCategoryName(zoom[1]) : null;

  return { category };
}

export function isCategoryStructureQuery(text: string): boolean {
  return extractCategoryStructureIntent(text) !== null;
}

export type CategoryLookupMode = "count" | "list";

export interface CategoryIntent {
  category: string;
  mode: CategoryLookupMode;
  inStockOnly?: boolean;
  /** Explicit list size when the customer asked for N products (e.g. list 20). */
  limit?: number;
  /**
   * Short/ambiguous browse term — ask clarifying questions (via browse_categories)
   * instead of dumping a product list or saying "not found".
   */
  clarify?: boolean;
}

const CATEGORY_STOP = new Set([
  "the",
  "a",
  "an",
  "our",
  "your",
  "this",
  "that",
  "these",
  "those",
  "them",
  "some",
  "any",
  "all",
  "related",
  "products",
  "product",
  "items",
  "item",
  "category",
  "categories",
  "store",
  "catalog",
  "please",
  "need",
  "want",
  "show",
  "list",
  "give",
  "me",
  "of",
  "in",
  "under",
  "from",
  "for",
  "how",
  "many",
  "count",
  "number",
  "total",
]);

function cleanCategoryName(raw: string): string | null {
  const cleaned = raw
    .replace(/[^a-z0-9\s+-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!cleaned) return null;

  // Exact nav labels (Collections, Kara, IBA Approved Boxing Range, …).
  if (isKnownBrowsePhrase(cleaned)) {
    return normalizeBrowsePhrase(cleaned);
  }

  const words = cleaned
    .split(" ")
    .filter((w) => w && !CATEGORY_STOP.has(w) && !/^\d+$/.test(w));
  if (words.length === 0 || words.length > 8) return null;
  const joined = words.join(" ");
  if (isKnownBrowsePhrase(joined)) {
    return normalizeBrowsePhrase(joined);
  }
  return joined;
}

/** Pull an explicit list size from phrases like "list 20 boxing gloves". */
export function extractListQuantity(text: string): number | null {
  const m = text
    .trim()
    .toLowerCase()
    .match(
      /\b(?:list|show|browse|give|get)\s+(?:me\s+)?(?:all\s+)?(\d{1,3})\b|\b(\d{1,3})\s+(?:products?|items?|options?)\b/i
    );
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, CATEGORY_LIST_MAX);
}

function isWholeCatalogHowManyTail(raw: string): boolean {
  const r = raw.trim().toLowerCase();
  return (
    /^(total\s+)?products?\b/.test(r) ||
    /^(do|are|we|you|there)\b/.test(r) ||
    /\bin\s+(the\s+)?(store|catalog|total)\b/.test(r) ||
    /\bacross\s+all\b/.test(r)
  );
}

/** True when the message is only a known browse/category phrase (no list/count verb). */
export function isBrowseClarifyQuery(text: string): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[?.!,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  return isKnownBrowsePhrase(t);
}

/**
 * Detect category/collection questions and whether they want a count or a list.
 * Count wins when both "list" and "count" appear (e.g. "list ... products count").
 * Bare category phrases return clarify:true so we ask follow-ups first.
 */
export function extractCategoryIntent(text: string): CategoryIntent | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  // Pronoun follow-ups reuse the prior category — handled separately.
  if (isCategoryFollowUpQuery(t)) return null;

  // "what categories do you have" / "how many subcategories in boxing"
  // are about the category tree, not products in one category.
  if (extractCategoryStructureIntent(t)) return null;

  // Whole-catalog clarifications are not a single category.
  if (
    /\b(all\s+categor(?:y|ies)|across\s+all(?:\s+categor(?:y|ies))?|entire\s+catalog|whole\s+catalog|whole\s+store)\b/i.test(
      t
    )
  ) {
    return null;
  }

  const listLimit = extractListQuantity(t);
  let category: string | null = null;

  // "how many products we have in strength training" / "products in belt"
  const productsIn = t.match(
    /\b(?:how\s+many\s+)?products?\s+(?:do\s+(?:we|you)\s+have\s+|we\s+have\s+|are\s+there\s+)?in\s+(?:the\s+)?(.+?)\s*\??$/i
  );
  if (productsIn?.[1] && !isWholeCatalogHowManyTail(productsIn[1])) {
    category = cleanCategoryName(productsIn[1]);
  }

  // "how many boxing gloves" / "how many yoga products"
  if (!category) {
    const howMany = t.match(/\bhow\s+many\s+(.+?)\s*\??$/i);
    if (howMany?.[1] && !isWholeCatalogHowManyTail(howMany[1])) {
      const raw = howMany[1].replace(/\s+products?\s*$/i, "").trim();
      if (!isWholeCatalogHowManyTail(raw)) {
        category = cleanCategoryName(raw);
      }
    }
  }

  // Prefer "... products in belt" / "list these products in belts" over
  // "list these products" (which would wrongly capture "these").
  // Quantity-aware: "list 20 boxing gloves" / "show me 10 yoga mats"
  const patterns: RegExp[] = [
    /\b(?:list|show|browse)\s+(?:me\s+)?(?:all\s+|these\s+|those\s+|some\s+)?(?:\d{1,3}\s+)?products?\s+in\s+(?:the\s+)?([a-z0-9][\w\s-]{1,40}?)\s*\??$/i,
    /\bproducts?\s+in\s+(?:the\s+)?([a-z0-9][\w\s-]{1,40}?)\s*(?:categor(?:y|ies))?\s*\??$/i,
    /\b(?:under|in|from|for)\s+(?:the\s+)?([a-z0-9][\w\s-]{0,40}?)\s+categor(?:y|ies)\b/i,
    /\b([a-z0-9][\w\s-]{1,40}?)\s+categor(?:y|ies)\b/i,
    /\b([a-z0-9][\w\s-]{0,40}?)\s*-?\s*related\s+products?\b/i,
    /\b(?:list|show|browse)\s+(?:me\s+)?(?:all\s+)?(?:\d{1,3}\s+)?([a-z0-9][\w\s-]{0,40}?)\s+products?\b/i,
    /\b(?:list|show|browse)\s+(?:me\s+)?(?:all\s+)?(?:\d{1,3}\s+)?([a-z0-9][\w\s-]{1,40}?)\s*\??$/i,
    /\b(?:count|number)\s+of\s+([a-z0-9][\w\s-]{0,40}?)\s+products?\b/i,
    /\b([a-z0-9][\w\s-]{1,40}?)\s+products?\s+count\b/i,
    /\bin\s+([a-z0-9][\w\s-]{1,40}?)\s+we\s+have\b/i,
  ];

  if (!category) {
    for (const re of patterns) {
      const m = t.match(re);
      if (!m?.[1]) continue;
      const cleaned = cleanCategoryName(m[1]);
      if (cleaned) {
        category = cleaned;
        break;
      }
    }
  }

  // Bare browse phrases ("boxing", "gloves", "boxing gloves") → clarify first.
  if (!category && isBrowseClarifyQuery(t)) {
    const phrase = t
      .replace(/[?.!,]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      category: phrase,
      mode: "list",
      clarify: true,
    };
  }

  if (!category) return null;

  // Prefer count when they ask for a count/how many/number — even if "list" appears.
  const wantsCount =
    /\b(count|how\s+many|number\s+of|total\s+(?:number\s+of\s+)?)\b/i.test(t) ||
    /\bproducts?\s+count\b/i.test(t) ||
    /\bin\s+.+\s+we\s+have\b/i.test(t);

  return {
    category,
    mode: wantsCount ? "count" : "list",
    ...(listLimit && !wantsCount ? { limit: listLimit } : {}),
  };
}

export function isCategoryQuery(text: string): boolean {
  return extractCategoryIntent(text) !== null;
}

export function isOffTopicQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (isOrderTrackingIntent(t) || isDiscountCodeQuery(t) || isDiscountQuery(t)) {
    return false;
  }
  if (isCatalogCountQuery(t)) return false;
  if (isCategoryQuery(t)) return false;
  if (isCategoryStructureQuery(t)) return false;
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
    !/\b(product|price|cost|size|stock|colour|color|order|shipping|delivery|discount|sale|buy|gloves|guard|kit|bundle|boxing|mma|store|available|difference|different|compare|versus|\bvs\b|better|which)\b/i.test(
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

/** Force catalog search only when the message clearly looks like a product request. */
export function shouldForceProductSearch(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  if (isDiscountCodeQuery(t)) return false;
  if (isCatalogCountQuery(t)) return false;
  if (isCategoryQuery(t)) return false;
  if (isCategoryStructureQuery(t)) return false;
  if (isCategoryFollowUpQuery(t)) return false;
  if (isBrowseClarifyQuery(t)) return false;
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
    if (rest && isBareOrderNumberToken(rest)) {
      // "find 1001" is usually another order number, not a SKU search.
      return false;
    }
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

function isDiscountQuery(text: string): boolean {
  if (isDiscountCodeQuery(text)) return false;
  return /\b(discount|discounts|discounted|sale|sales|on\s+sale|offer|offers|deal|deals|reduced|clearance|promo|promotion|promotions|bargain|markdown)\b/i.test(
    text
  );
}

/**
 * Sale/discount question about a named product (e.g. "is the ARLO belt on sale?")
 * — must search that product, not browse the general sale list.
 */
export function isNamedProductSaleQuery(text: string): boolean {
  if (!isDiscountQuery(text)) return false;

  // Explicit browse-all-sales phrasing.
  if (
    /\b(what(?:'s|\s+is)?\s+on\s+sale|products?\s+on\s+sale|items?\s+on\s+sale|show\s+(?:me\s+)?(?:sale|discounted|deals?)|any\s+(?:deals?|sales?|discounts?)|list\s+(?:sale|discounted)|currently\s+on\s+sale)\b/i.test(
      text
    )
  ) {
    return false;
  }

  const stripped = text
    .replace(
      /\b(discount|discounts|discounted|sale|sales|on\s+sale|offer|offers|deal|deals|reduced|clearance|promo|promotion|promotions|bargain|markdown|price|prices|is|are|there|any|a|an|the|this|that|for|on|of|do|does|did|have|has|currently|active|available|percent|off|how\s+much)\b/gi,
      " "
    )
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return stripped.split(/\s+/).filter(Boolean).length >= 1;
}

interface CategorySummary {
  name: string;
  productCount: number | null;
  subcategoryCount: number;
  subcategories?: CategorySummary[];
}

function summarizeTaxonomyNode(
  node: TaxonomyNode,
  depth: number
): CategorySummary {
  const summary: CategorySummary = {
    name: node.title,
    productCount: node.productCount,
    subcategoryCount: node.children.length,
  };
  if (depth > 0 && node.children.length > 0) {
    summary.subcategories = node.children.map((c) =>
      summarizeTaxonomyNode(c, depth - 1)
    );
  }
  return summary;
}

/**
 * Nav collections are often empty placeholders while products live under
 * related titles/types (Sauna Shorts → Sweat Shorts). Refresh zero counts
 * before showing subcategory sizes to the customer.
 */
async function enrichZeroProductCounts(
  node: TaxonomyNode,
  options: { signal?: AbortSignal }
): Promise<TaxonomyNode> {
  const children = await Promise.all(
    node.children.map(async (child) => {
      const enrichedChild = await enrichZeroProductCounts(child, options);
      if (
        enrichedChild.productCount !== null &&
        enrichedChild.productCount > 0
      ) {
        return enrichedChild;
      }

      try {
        const estimated = await estimateCategoryProductCount(
          enrichedChild.title,
          { signal: options.signal }
        );
        if (estimated.count > 0) {
          return { ...enrichedChild, productCount: estimated.count };
        }
      } catch {
        // Keep original count on lookup failure.
      }
      return enrichedChild;
    })
  );

  let productCount = node.productCount;
  if ((productCount === null || productCount === 0) && node.children.length === 0) {
    try {
      const estimated = await estimateCategoryProductCount(node.title, {
        signal: options.signal,
      });
      if (estimated.count > 0) productCount = estimated.count;
    } catch {
      // keep
    }
  }

  return { ...node, productCount, children };
}

async function runBrowseCategories(
  categoryArg: string,
  options: { signal?: AbortSignal; clarify?: boolean }
): Promise<string> {
  const taxonomy = await getStoreTaxonomy({ signal: options.signal });
  const clarify = Boolean(options.clarify);

  const emptyCountHint =
    "productCount may be enriched beyond empty nav collections (products often match related names like Sweat Shorts for Sauna Shorts). A count of 0 means we still found nothing via collection, product type, tags, or title aliases — only then say that subcategory looks empty, and offer to search by product name. Never invent counts.";

  if (categoryArg) {
    const node = findTaxonomyNode(taxonomy, categoryArg);
    if (!node) {
      // Try parent token for phrases like "boxing gloves" → "boxing"
      const parentToken = categoryArg.trim().split(/\s+/)[0] ?? "";
      const parentNode =
        parentToken && parentToken.toLowerCase() !== categoryArg.toLowerCase()
          ? findTaxonomyNode(taxonomy, parentToken)
          : null;
      if (parentNode) {
        const enriched = await enrichZeroProductCounts(parentNode, options);
        return wrapToolData({
          category: summarizeTaxonomyNode(enriched, 2),
          requested: categoryArg,
          leafSubcategoryCount: countLeafSubcategories(enriched),
          hint: clarify
            ? `The customer is browsing "${categoryArg}". Use these related subcategories to ask a natural follow-up with bullet options (types, use cases). Do NOT say products were not found. Do NOT dump the full catalog. ${emptyCountHint}`
            : `Closest matching parent category from navigation. Answer using these names. Offer to show products from a subcategory via lookup_category. ${emptyCountHint}`,
        });
      }
      return wrapToolData({
        category: categoryArg,
        found: false,
        mainCategories: taxonomy.categories.map((c) => c.title),
        hint: clarify
          ? `The customer sent a short browse term ("${categoryArg}"). Even without an exact nav match, ask a natural clarifying question with likely options (e.g. for gloves: boxing / MMA / bag / sparring). Never say the catalog has no products. Invite them to narrow size, use, or budget.`
          : "That category was not found in the store navigation. Tell the customer, then offer the mainCategories list so they can pick one. Do not invent subcategories.",
      });
    }
    const enriched = await enrichZeroProductCounts(node, options);
    return wrapToolData({
      category: summarizeTaxonomyNode(enriched, 2),
      leafSubcategoryCount: countLeafSubcategories(enriched),
      hint: clarify
        ? `The customer sent a short/ambiguous browse term. Do NOT dump a long product list and do NOT say products were not found. Use these subcategory names to ask a natural follow-up (bullet options). Offer to list products once they pick one. ${emptyCountHint}`
        : `This is the store category tree. Answer using these names and counts. ${emptyCountHint} Offer to show products from any subcategory via lookup_category.`,
    });
  }

  return wrapToolData({
    totalMainCategories: taxonomy.categories.length,
    categories: taxonomy.categories.map((c) => summarizeTaxonomyNode(c, 1)),
    hint: clarify
      ? "The customer sent a short browse term. Ask a natural clarifying question using related mainCategories (or common product types). Never say the catalog is empty. Offer options and invite them to narrow down."
      : "These are the store's main categories and their direct subcategories from the site navigation. For 'how many categories' answer with totalMainCategories and name them. productCount null = unknown — never invent numbers. Offer to explore any category's subcategories or products.",
  });
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  options: { region?: ShopifyStoreRegion; signal?: AbortSignal }
): Promise<string> {
  try {
    if (name === "search_products") {
      const keyword = String(args.keyword ?? "").trim();
      if (!keyword) return JSON.stringify({ error: "keyword is required" });

      const products = await searchProducts(keyword, SEARCH_RESULT_LIMIT, {
        signal: options.signal,
      });
      if (products.length === 0) {
        return wrapToolData({
          results: [],
          hint:
            "No products matched this keyword yet. Retry once with shorter or related keywords (e.g. gloves → boxing gloves). If still empty after expansion, ask what they are looking for in a natural way — do NOT sound like a failed database search. Never invent products.",
        });
      }
      return wrapToolData({
        results: products.map(toToolProduct),
        resultCount: products.length,
        hint:
          "These are matching search results (limited sample), not the total number of products in the store. For a whole-catalog total, use count_products.",
      });
    }

    if (name === "count_products") {
      const { count, precision } = await countStorefrontProducts({
        signal: options.signal,
      });
      return wrapToolData({
        totalProducts: count,
        precision,
        scope: "Active products published on the Online Store (all categories)",
        hint:
          "This is the total catalog count across all categories. Tell the customer this number. Do not list every product unless they ask. Never invent a different number. Never treat a prior search result count as the store total.",
      });
    }

    if (name === "lookup_category") {
      const category = String(args.category ?? "").trim();
      const modeRaw = String(args.mode ?? "count").trim().toLowerCase();
      const mode: "count" | "list" = modeRaw === "list" ? "list" : "count";
      const inStockOnly = Boolean(args.inStockOnly);
      const limitRaw = Number(args.limit);
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.min(Math.floor(limitRaw), CATEGORY_LIST_MAX)
          : undefined;
      if (!category) return JSON.stringify({ error: "category is required" });

      const result = await lookupCategory(category, mode, {
        signal: options.signal,
        inStockOnly,
        limit,
      });

      if (result.source === "none" || result.totalProducts === 0) {
        return wrapToolData({
          category,
          mode,
          inStockOnly,
          totalProducts: 0,
          matchedCollection: null,
          productType: null,
          results: [],
          hint:
            "No exact category/productType/collection match yet. Do NOT immediately say the store has no products. Ask a natural clarifying question about what they want (type, size, use case), offer related categories from browse_categories, or retry search_products with related keywords. Only after those fail should you gently say you could not find a match.",
        });
      }

      const matchedCollection = result.matched
        ? {
            title: result.matched.title,
            handle: result.matched.handle,
            collectionCount: result.matched.productsCount,
          }
        : null;

      const sampleLimit = limit ?? CATEGORY_SAMPLE_LIMIT;

      // List mode with a known total must never claim the category is empty.
      if (mode === "list" && result.products.length === 0 && result.totalProducts > 0) {
        return wrapToolData({
          category,
          mode: "list",
          inStockOnly,
          totalProducts: result.totalProducts,
          precision: result.precision,
          productType: result.productType,
          matchedCollection,
          source: result.source,
          results: [],
          sampleCount: 0,
          hint: inStockOnly
            ? `There are ${result.totalProducts} products in this category, but none of the loaded items are currently in stock. Tell the customer that clearly — do NOT say the category itself was not found. Offer to list all products (including out of stock) or help with another category.`
            : `There are ${result.totalProducts} products in this category/productType, but the sample list could not be loaded. Tell the customer the count and ask them to try again. Do NOT say the category is empty.`,
        });
      }

      if (mode === "count") {
        return wrapToolData({
          category,
          mode: "count",
          totalProducts: result.totalProducts,
          precision: result.precision,
          productType: result.productType,
          matchedCollection,
          source: result.source,
          hint:
            "Reply with the category product COUNT only (totalProducts). This may come from Shopify productType (e.g. Boxing Gloves) or a collection. Do NOT list products. Example: \"There are 54 Boxing Gloves products.\" Offer to list some if they want.",
        });
      }

      const ranked = prioritizeInStock(result.products).slice(0, sampleLimit);
      const useCompact = ranked.length >= LARGE_LIST_THRESHOLD;

      return wrapToolData({
        category,
        mode: "list",
        inStockOnly,
        totalProducts: result.totalProducts,
        precision: result.precision,
        productType: result.productType,
        matchedCollection,
        source: result.source,
        results: useCompact
          ? ranked.map(toCompactToolProduct)
          : ranked.map(toToolProduct),
        sampleCount: ranked.length,
        requestedLimit: limit ?? null,
        layout: useCompact ? "compact" : "detailed",
        hint: inStockOnly
          ? "List the in-stock products from results. Mention the category totalProducts if useful. Never say the category was not found when results are present."
          : useCompact
            ? `CRITICAL: results has sampleCount=${ranked.length} products. You MUST list ALL ${ranked.length} using the COMPACT LIST LAYOUT (one line each). Say you are showing ${ranked.length} of ${result.totalProducts} — never claim more than sampleCount. Do not stop early. Do not use the detailed multi-line layout.`
            : limit
              ? `The customer asked for about ${limit} products. List every item in results (sampleCount=${ranked.length}). Mention totalProducts if the category is larger.`
              : result.totalProducts > 10
                ? "Say the totalProducts count, then briefly list this sample. Never claim the sample size is the full category count."
                : "Say the totalProducts count for this category/productType, then briefly list the sample in results. Make clear this is a sample when sampleCount < totalProducts. Never claim the sample size is the full category count.",
      });
    }

    if (name === "browse_categories") {
      const category = String(args.category ?? "").trim();
      return runBrowseCategories(category, {
        signal: options.signal,
        clarify: Boolean(args.clarify),
      });
    }

    if (name === "list_discounted_products") {
      const products = await getDiscountedProducts(DISCOUNT_RESULT_LIMIT, {
        signal: options.signal,
      });
      if (products.length === 0) {
        return wrapToolData({
          results: [],
          hint:
            "No products are currently on sale. Tell the customer there are no active discounts right now — do not invent any.",
        });
      }
      return wrapToolData({
        results: products.map(toToolProduct),
        hint: `Found ${products.length} product(s) on sale. List ALL of them briefly.`,
      });
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
function resolveTurnIntent(
  lastUser: string,
  session: ChatSession,
  flags?: {
    wantsDiscounts?: boolean;
    wantsCatalogCount?: boolean;
    structureIntent?: boolean;
    categoryIntent?: boolean;
    productIntent?: boolean;
  },
): string {
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
  if (flags?.wantsDiscounts || isDiscountQuery(lastUser)) return "discount";
  if (flags?.wantsCatalogCount || isCatalogCountQuery(lastUser)) {
    return "catalog_count";
  }
  if (flags?.structureIntent || extractCategoryStructureIntent(lastUser)) {
    return "category_browse";
  }
  if (
    flags?.categoryIntent ||
    extractCategoryIntent(lastUser) ||
    isCategoryFollowUpQuery(lastUser) ||
    isBrowseClarifyQuery(lastUser)
  ) {
    return "category_lookup";
  }
  if (/^product information$/i.test(lastUser.trim())) {
    return "product_information";
  }
  if (
    flags?.productIntent ||
    shouldForceProductSearch(lastUser) ||
    isProductFollowUpQuery(lastUser) ||
    isNamedProductSaleQuery(lastUser)
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

  const namedProductSale = isNamedProductSaleQuery(lastUser);
  const wantsDiscounts = isDiscountQuery(lastUser) && !namedProductSale;
  const wantsCatalogCount = isCatalogCountQuery(lastUser);
  const structureIntent = extractCategoryStructureIntent(lastUser);
  const explicitCategoryIntent = extractCategoryIntent(lastUser);
  const categoryFollowUp = isCategoryFollowUpQuery(lastUser);
  const inStockOnly = wantsInStockOnly(lastUser);
  const priorCategory =
    session.pendingCategory || extractLastCategoryFromHistory(history);

  // Follow-ups like "list the ones in stock" reuse the last category.
  const categoryIntent: CategoryIntent | null = explicitCategoryIntent
    ? {
        ...explicitCategoryIntent,
        inStockOnly: inStockOnly || Boolean(explicitCategoryIntent.inStockOnly),
      }
    : categoryFollowUp && priorCategory
      ? {
          category: priorCategory,
          mode: "list",
          inStockOnly,
        }
      : null;

  const wantsClarifyBrowse = Boolean(categoryIntent?.clarify);
  const isFollowUp =
    isProductFollowUpQuery(lastUser) || Boolean(categoryFollowUp);
  const forceSearch =
    !wantsDiscounts &&
    !wantsCatalogCount &&
    !structureIntent &&
    !categoryIntent &&
    !isFollowUp &&
    (namedProductSale || shouldForceProductSearch(lastUser));
  const productIntent =
    forceSearch ||
    wantsDiscounts ||
    wantsCatalogCount ||
    Boolean(structureIntent) ||
    Boolean(categoryIntent) ||
    (isFollowUp && hasRecentProductContext(history));

  setSessionIntent(
    session,
    resolveTurnIntent(lastUser, session, {
      wantsDiscounts,
      wantsCatalogCount,
      structureIntent: Boolean(structureIntent),
      categoryIntent: Boolean(categoryIntent),
      productIntent,
    }),
  );

  const conversation: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  let sawEmptyCatalog = false;
  let usedDiscountTool = false;
  let usedCountTool = false;
  let needsLargeListBudget = Boolean(
    categoryIntent?.limit && categoryIntent.limit >= LARGE_LIST_THRESHOLD
  );

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal.aborted) {
      return finishWithReply(session, FALLBACK_REPLY);
    }

    let toolChoice: ChatCompletionToolChoiceOption = "auto";
    if (round === 0) {
      if (structureIntent || wantsClarifyBrowse) {
        toolChoice = {
          type: "function",
          function: { name: "browse_categories" },
        };
      } else if (categoryIntent) {
        toolChoice = {
          type: "function",
          function: { name: "lookup_category" },
        };
      } else if (wantsCatalogCount) {
        toolChoice = {
          type: "function",
          function: { name: "count_products" },
        };
      } else if (wantsDiscounts) {
        toolChoice = {
          type: "function",
          function: { name: "list_discounted_products" },
        };
      } else if (forceSearch) {
        toolChoice = { type: "function", function: { name: "search_products" } };
      }
    }

    const completion = await client.chat.completions.create(
      {
        model,
        messages: conversation,
        tools,
        tool_choice: toolChoice,
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
      // Prefer deterministic structure / browse-clarify intent over model-guessed args.
      if (
        toolCall.function.name === "browse_categories" &&
        (structureIntent || wantsClarifyBrowse) &&
        round === 0
      ) {
        const zoom =
          structureIntent?.category ??
          (wantsClarifyBrowse ? categoryIntent?.category : null);
        args = zoom
          ? { category: zoom, clarify: wantsClarifyBrowse }
          : { clarify: wantsClarifyBrowse };
      }
      // Prefer deterministic category intent over model-guessed args.
      if (
        toolCall.function.name === "lookup_category" &&
        categoryIntent &&
        !categoryIntent.clarify
      ) {
        args = {
          category: categoryIntent.category,
          mode: categoryIntent.mode,
          inStockOnly: Boolean(categoryIntent.inStockOnly),
          ...(categoryIntent.limit ? { limit: categoryIntent.limit } : {}),
        };
      }
      const isDiscountTool = toolCall.function.name === "list_discounted_products";
      const isCountTool =
        toolCall.function.name === "count_products" ||
        toolCall.function.name === "lookup_category" ||
        toolCall.function.name === "browse_categories";
      if (isDiscountTool) usedDiscountTool = true;
      if (isCountTool) usedCountTool = true;
      const result = await runTool(toolCall.function.name, args, { region, signal });

      if (
        toolCall.function.name === "lookup_category" ||
        toolCall.function.name === "browse_categories"
      ) {
        const cat = String(args.category ?? "").trim();
        if (cat) setPendingCategory(session, cat);
      }

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

      try {
        const unwrapped = result.includes("<CATALOG_DATA>")
          ? result.replace(/<\/?CATALOG_DATA>/g, "").trim()
          : result;
        const parsed = JSON.parse(unwrapped) as {
          results?: unknown[];
          totalProducts?: number;
          sampleCount?: number;
          layout?: string;
        };
        if (
          typeof parsed.sampleCount === "number" &&
          parsed.sampleCount >= LARGE_LIST_THRESHOLD
        ) {
          needsLargeListBudget = true;
        }
        if (parsed.layout === "compact") {
          needsLargeListBudget = true;
        }
        if (isCountTool) {
          sawEmptyCatalog = false;
        } else if (
          !isDiscountTool &&
          Array.isArray(parsed.results) &&
          parsed.results.length === 0
        ) {
          sawEmptyCatalog = true;
        } else if (Array.isArray(parsed.results) && parsed.results.length > 0) {
          sawEmptyCatalog = false;
          if (parsed.results.length >= LARGE_LIST_THRESHOLD) {
            needsLargeListBudget = true;
          }
        }
      } catch {
        // ignore
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
    productIntent && sawEmptyCatalog && !usedDiscountTool && !usedCountTool
      ? NOT_AVAILABLE_REPLY
      : FALLBACK_REPLY
  );
}
