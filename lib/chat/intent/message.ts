/**
 * Shopping-message classification: decides whether a customer message is a
 * product browse/search, a follow-up about products already discussed, a count
 * question, or clearly off-topic. These rules are mutually dependent, so they
 * live together as one cohesive "shopping intent" responsibility.
 */

import { isValidEmailInput } from "@/lib/chatbot/orderTracking";
import type { ChatMessagePayload } from "@/lib/types";
import { CATEGORY_BROWSE_PHRASES, QUERY_TYPO_MAP } from "@/lib/chat/intent/patterns";
import { isDiscountCodeQuery, isDiscountQuery } from "@/lib/chat/intent/discount";
// import { isHarmfulQuery } from "@/lib/chat/intent/safety";
import {
  isBareOrderNumberToken,
  isOrderTrackingIntent,
} from "@/lib/chat/intent/order";
import { isCategoryStyleQuery } from "@/lib/shopify/storefront-collection";
import { isProductSpecificQuery } from "@/lib/shopify/storefront-product-search";

/**
 * Server-side catalog reply mode. Drives exact totals and product payload caps
 * (category/count → 5, explicit list → 20) independently of model tool args.
 */
export type CatalogResponseMode = "list" | "category" | "specific" | "generic";

/** Soft-correct typos and store taxonomy synonyms before catalog search. */
export function normalizeSearchQuery(query: string): string {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  if (QUERY_TYPO_MAP[lower]) return QUERY_TYPO_MAP[lower];

  // Customers say "headgear"; the store category is "Head Guards".
  return trimmed
    .replace(/\bhead[\s-]?gears?\b/gi, "head guards")
    .replace(/\bheadguards?\b/gi, "head guards");
}

/** True when the shopper is asking for a category/product count (any category). */
export function isCatalogCountQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /\bhow\s+many\b/i.test(t) ||
    /\bnumber\s+of\b/i.test(t) ||
    /\bcount\s+of\b/i.test(t)
  );
}

/**
 * Normalize a customer message to a bare browse phrase key
 * (lowercase, trim, strip trailing punctuation).
 */
export function normalizeBrowseKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[?.!,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Explicit "show/list all/every …" — return total + up to 20 products.
 * Does not match softer "show me boxing gloves" (that is category mode).
 */
export function isExplicitCatalogListQuery(text: string): boolean {
  const key = normalizeBrowseKey(text);
  if (!key) return false;

  if (
    /\b(show|list|display|browse|see|give)\b/i.test(key) &&
    /\b(all|every)\b/i.test(key)
  ) {
    return true;
  }

  if (/\ball\s+(?:the\s+)?(?:products?|items?|options?)\b/i.test(key)) {
    return true;
  }

  if (/\b(?:products?|items?)\s+in\s+this\s+category\b/i.test(key)) {
    return true;
  }

  return false;
}

/**
 * Exact unit / inventory questions for a product already in context (or named).
 * Distinct from category counts like "how many boxing gloves".
 */
export function isInventoryQuantityQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  if (
    /\b(inventory|stock\s+level|units?\s+(?:available|left|in\s+stock))\b/i.test(
      t,
    )
  ) {
    return true;
  }

  if (
    /\bhow\s+many\s+(?:are|is|units?|items?)?\s*(?:available|in\s+stock|left)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  if (
    /\bhow\s+many\s+(?:of\s+)?(?:these|those|them|it|this|that)\b/i.test(t)
  ) {
    return true;
  }

  // Named product + availability quantity, e.g. "How many RDX T15 are available?"
  if (
    /\bhow\s+many\b/i.test(t) &&
    /\b(available|in\s+stock|left)\b/i.test(t) &&
    isProductSpecificQuery(t)
  ) {
    return true;
  }

  if (
    /\b(?:is|are)\s+(?:this|that|it|these|those|the\s+product)?\s*(?:product\s+)?(?:in\s+stock|available)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Category browse or category-count questions → exact total + up to 5 products.
 * Excludes explicit full-list and product-unit inventory asks.
 */
export function isCategoryBrowseQuery(text: string): boolean {
  const key = normalizeBrowseKey(text);
  if (!key) return false;
  if (isExplicitCatalogListQuery(key)) return false;
  if (isInventoryQuantityQuery(key)) return false;

  if (isCatalogCountQuery(key)) return true;
  if (isAmbiguousBrowseQuery(key)) return true;

  const normalized = normalizeSearchQuery(key);
  if (
    isCategoryStyleQuery(normalized) &&
    !isProductSpecificQuery(normalized)
  ) {
    return true;
  }

  return false;
}

/**
 * Resolve how search_catalog should shape its payload for this turn.
 * Priority: list > category (incl. how-many) > specific > generic.
 */
export function resolveCatalogResponseMode(
  lastUser: string,
  query: string,
): CatalogResponseMode {
  const user = (lastUser || "").trim();
  const q = (query || "").trim();
  const primary = user || q;
  const secondary = q || user;

  if (
    isExplicitCatalogListQuery(primary) ||
    isExplicitCatalogListQuery(secondary)
  ) {
    return "list";
  }

  if (isCategoryBrowseQuery(primary) || isCategoryBrowseQuery(secondary)) {
    return "category";
  }

  const normalized = normalizeSearchQuery(secondary || primary);
  if (
    isProductSpecificQuery(normalized) ||
    isProductSpecificQuery(primary)
  ) {
    return "specific";
  }

  return "generic";
}

/** Explicit list / show / count phrasing — search immediately. */
export function hasExplicitCatalogListOrCountIntent(key: string): boolean {
  if (!key) return false;
  if (isCatalogCountQuery(key)) return true;
  if (isExplicitCatalogListQuery(key)) return true;
  return (
    /\b(show|list|display|browse)\s+(?:me\s+)?(?:all\s+|some\s+|the\s+)?/i.test(
      key,
    ) ||
    /\bwhat\s+.+\s+(?:are|is)\s+available\b/i.test(key) ||
    /\b(?:available|in\s+stock)\s+.+\b/i.test(key) ||
    /\bsee\s+(?:all\s+|the\s+)?(?:products?|options?|items?)\b/i.test(key)
  );
}

/**
 * Broad "I need gloves / protection / equipment" style asks that should get a
 * clarifying follow-up instead of an immediate catalog dump.
 */
export function needsProductClarification(text: string): boolean {
  const key = normalizeBrowseKey(text);
  if (!key) return false;
  if (hasExplicitCatalogListOrCountIntent(key)) return false;
  if (isCatalogCountQuery(key)) return false;

  // Already narrowed (use-case + product type) — search, don't clarify.
  if (
    /\b(training|sparring|competition|boxing|mma|bag|kids?|fitness|workout|lifting)\b/i.test(
      key,
    ) &&
    /\b(gloves?|bags?|guards?|headgears?|shorts?|shoes|boots|pads?|wraps?)\b/i.test(
      key,
    )
  ) {
    return false;
  }

  // "I need gloves", "looking for protection", bare "gloves" / "equipment"
  if (
    /^(?:(?:i\s+)?(?:need|want|looking\s+for|get\s+me|find\s+me)(?:\s+some|\s+any)?\s+)?(?:gloves?|protection(?:\s+gear)?|gear|equipment|gym\s+equipment|fitness\s+equipment)$/i.test(
      key,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * True when the message is only a category browse phrase
 * (e.g. "boxing", "gloves", "boxing gloves").
 */
export function isAmbiguousBrowseQuery(text: string): boolean {
  const key = normalizeBrowseKey(text);
  if (!key) return false;
  if (hasExplicitCatalogListOrCountIntent(key)) return false;
  // Specific enough already (use-case + product type)
  if (
    /\b(training|sparring|competition|bag|kids?|fitness|workout|lifting)\s+/i.test(
      key,
    ) &&
    /\b(gloves?|bags?|guards?|shorts?|shoes|boots)\b/i.test(key)
  ) {
    return false;
  }
  // Model / SKU style names should search as specific products
  if (/\b(rdx|[a-z]*\d+[a-z]*|\d+oz)\b/i.test(key)) return false;
  return CATEGORY_BROWSE_PHRASES.has(key);
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
      t,
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
      t,
    )
  ) {
    return true;
  }

  return false;
}

/** Recent turns look like product Q&A — keep follow-ups with the LLM. */
export function hasRecentProductContext(
  history: ChatMessagePayload[],
  lookback = 6,
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
      t,
    )
  ) {
    return true;
  }

  // Homework / coding / essays — not shopping
  if (
    /\b(write\s+(me\s+)?(an?\s+)?(essay|poem|story|code|script)|solve\s+this|homework|calculate|translate\s+this)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  // Standalone trivia-style "what is X" — not product follow-ups or shopping terms.
  // Note: use products? so "how many products…" is never treated as off-topic.
  if (
    /^(what(?:'s|\s+is)|who(?:'s|\s+is)|where(?:'s|\s+is)|when(?:'s|\s+is)|why(?:'s|\s+is)|how\s+(?:do|does|did|can|many|much)\b)/i.test(
      t,
    ) &&
    !/\b(products?|items?|price|cost|size|stock|colour|color|order|shipping|delivery|discount|sale|buy|gloves?|vests?|suits?|guards?|mats?|wraps?|bags?|belts?|shin|sauna|sweat|kit|bundle|boxing|mma|store|available|difference|different|compare|versus|\bvs\b|better|which|policy|policies|return|refund)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

/** Message clearly looks like a product / shopping request. */
export function shouldForceProductSearch(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  // if (isHarmfulQuery(t)) return false;

  // Broad "I need gloves/protection/equipment" → clarify first, don't force search.
  if (needsProductClarification(t)) return false;

  // Clearer category browse (e.g. "boxing gloves", "head guards") → search now.
  if (isAmbiguousBrowseQuery(t)) return true;

  if (isDiscountCodeQuery(t)) return false;
  if (isOrderTrackingIntent(t)) return false;
  if (isOffTopicQuery(t)) return false;
  if (isBareOrderNumberToken(t)) return false;
  if (isValidEmailInput(t)) return false;

  if (
    /^(hi|hello|hey|good\s+(morning|afternoon|evening)|thanks|thank you|ok|okay|bye)\b/.test(
      t,
    ) &&
    t.length < 40
  ) {
    return false;
  }

  if (t === "product information") return false;

  // Pure policy / shipping / store-info questions belong to the policies tool.
  if (
    /\b(ship|shipping|delivery|hours?|opening|return|refund|damaged|place\s+(an\s+)?order|policy|policies)\b/.test(
      t,
    ) &&
    !/\b(product|price|size|stock|colour|color|available|gloves|guard|kit|bundle)\b/.test(
      t,
    )
  ) {
    return false;
  }

  // Explicit product / shopping signals.
  if (
    /\b(price|cost|how much|in stock|available|size|colour|color|variant|buy|link|url|product|products|gloves|guard|shoes|kit|bundle|shin|boxing|mma|robe|looking\s+for|do\s+you\s+(?:have|sell)|show\s+me)\b/i.test(
      t,
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
      t,
    )
  ) {
    return true;
  }

  return false;
}
