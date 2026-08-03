/**
 * Shopping-message classification: decides whether a customer message is a
 * product browse/search, a follow-up about products already discussed, a count
 * question, or clearly off-topic. These rules are mutually dependent, so they
 * live together as one cohesive "shopping intent" responsibility.
 */

import { isValidEmailInput } from "@/lib/chatbot/orderTracking";
import type { ChatMessagePayload } from "@/lib/types";
import {
  PRODUCT_MODEL_CODE_RE,
  PRODUCT_NOUN_RE,
  PURCHASE_INTENT_RE,
  QUERY_TYPO_MAP,
} from "@/lib/chat/intent/patterns";
import { isDiscountCodeQuery, isDiscountQuery } from "@/lib/chat/intent/discount";
import { isHarmfulQuery } from "@/lib/chat/intent/safety";
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
 * When a count/category query contains a product model code alongside a
 * category word (e.g. "f4 gloves", "f4 boxing gloves"), splitting them lets
 * the collection resolver find the right Shopify collection using just the
 * category part ("gloves" / "boxing gloves"), while still filtering returned
 * products to those whose title contains the model code.
 *
 * Returns null when the query has no model code, or when stripping the model
 * code leaves nothing meaningful (bare model code query).
 *
 * Weight sizes ("14oz") are excluded so they are never treated as model codes.
 */
export function extractModelCodeFromQuery(
  query: string,
): { modelCode: string; categoryQuery: string } | null {
  // Strip weight sizes first so "14oz" is never treated as a model code.
  const withoutSizes = query.replace(/\b\d{1,2}\s*oz\b/gi, " ").trim();
  const match = withoutSizes.match(PRODUCT_MODEL_CODE_RE);
  if (!match) return null;
  const modelCode = match[0]!;
  // Remove the model code token from the original query.
  const categoryQuery = query
    .replace(new RegExp(`\\b${modelCode}\\b`, "i"), "")
    .trim()
    .replace(/\s+/g, " ");
  // Need at least 2 chars of category text remaining to be useful.
  return categoryQuery.length >= 2 ? { modelCode, categoryQuery } : null;
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
 *
 * IMPORTANT: count intent ("how many") always wins over specific-product mode.
 * A query like "how many F4 gloves" contains a model code that would normally
 * trigger isProductSpecificQuery, but the customer wants a COUNT — the
 * collection/category path must run so we return an exact total.
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

  // Count intent in the user message always forces category mode, even when
  // the model-generated query looks product-specific (e.g. "f4 gloves" with
  // model code F4 matching MODEL_TOKEN_RE / isProductSpecificQuery).
  if (isCatalogCountQuery(primary) || isCatalogCountQuery(secondary)) {
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
 * Heuristic for ultra-broad browse asks. Live category discovery is the
 * authoritative clarifier; this is a fast pre-check for single-token / bare
 * product-family asks.
 */
export function needsProductClarification(text: string): boolean {
  const key = normalizeBrowseKey(text);
  if (!key) return false;
  if (hasExplicitCatalogListOrCountIntent(key)) return false;
  if (isCatalogCountQuery(key)) return false;
  if (hasNamedProductModel(key)) return false;

  // "I need gloves" / "looking for protection" / bare family nouns.
  if (
    /^(?:(?:i\s+)?(?:need|want|looking\s+for|get\s+me|find\s+me)(?:\s+some|\s+any)?\s+)?(?:gloves?|protection(?:\s+gear)?|gear|equipment|gym\s+equipment|fitness\s+equipment)$/i.test(
      key,
    )
  ) {
    return true;
  }

  // Already narrowed: use-case + product type → search.
  if (
    /\b(training|sparring|competition|bag|kids?|workout|lifting|beginner|professional|speed)\b/i.test(
      key,
    ) &&
    PRODUCT_NOUN_RE.test(key)
  ) {
    return false;
  }

  // Multi-word product types ("boxing gloves", "yoga mats") → search, not clarify.
  const words = key.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return false;

  // Single department / family token → clarify.
  if (words.length === 1 && words[0]!.length >= 3) {
    return !PRODUCT_MODEL_CODE_RE.test(words[0]!);
  }

  return false;
}

/**
 * True when the message looks like a category browse that should search
 * (multi-word product language), not an ultra-broad clarify-first ask.
 */
export function isAmbiguousBrowseQuery(text: string): boolean {
  const key = normalizeBrowseKey(text);
  if (!key) return false;
  if (hasExplicitCatalogListOrCountIntent(key)) return false;
  if (needsProductClarification(key)) return false;
  if (hasNamedProductModel(key)) return false;
  if (isOrderTrackingIntent(key) || isOffTopicQuery(key)) return false;
  // Use-case + product type is specific enough — handled by force-search signals.
  if (
    /\b(training|sparring|competition|bag|kids?|workout|lifting|speed)\b/i.test(
      key,
    ) &&
    PRODUCT_NOUN_RE.test(key)
  ) {
    return false;
  }
  // Multi-word with a product noun → browse/search candidate.
  const words = key.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  return PRODUCT_NOUN_RE.test(key);
}

/**
 * True when the customer expresses purchase / product interest in natural
 * language ("I want to buy…", "interested in…", brand + model + product noun).
 * Professional retail bots treat these as catalog turns, not clarification.
 */
export function isPurchaseOrProductInterest(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (isHarmfulQuery(t) || isOrderTrackingIntent(t) || isOffTopicQuery(t)) {
    return false;
  }
  if (isDiscountCodeQuery(t)) return false;

  if (PURCHASE_INTENT_RE.test(t)) return true;

  // Brand + product noun / model code ("RDX 2W SPEED PUNCHING BALL").
  if (/\brdx\b/i.test(t) && (PRODUCT_NOUN_RE.test(t) || hasNamedProductModel(t))) {
    return true;
  }

  // Named model + product noun without explicit "buy".
  if (hasNamedProductModel(t) && PRODUCT_NOUN_RE.test(t)) return true;

  return false;
}

/**
 * True when the message names a product series/model (F4, F6, T15…) rather
 * than only referring to items already shown ("these", "the two", "14oz").
 */
export function hasNamedProductModel(text: string): boolean {
  // Strip weight sizes so "14oz" / "16 oz" never look like model codes.
  const withoutSizes = text.replace(/\b\d{1,2}\s*oz\b/gi, " ");
  return PRODUCT_MODEL_CODE_RE.test(withoutSizes);
}

/**
 * Follow-ups that refer to products already in the conversation
 * ("difference between the two", "which size", "what about the black one").
 * Named-model comparisons ("compare F4 and F6 gloves") are NOT follow-ups —
 * they need a fresh catalog search.
 */
export function isProductFollowUpQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  // "compare F4 and F6" / "difference between T15 and T6" → new product lookup.
  if (hasNamedProductModel(t)) return false;

  // 1. Comparison, selection, or question about items ("which of them", "which of these", "compare", "difference", "which is", "are any of them")
  if (
    /\b(difference|different|differ|compare|comparison|versus|vs\.?|which\s+(?:one|is|are|should|glove|product|size|weight|material|use|colour|color|of|has|have|among|were|item|option)|better(?:\s+for)?|between\s+(the\s+)?(two|them|these|those)|(?:the|these|those)\s+two|both(?:\s+of\s+them)?|first\s+one|second\s+one|third\s+one|that\s+one|this\s+one|the\s+other(?:\s+one)?|same\s+as|similar)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  // 2. Short follow-up conjunctions ("and the...", "what about...", "how about...", "same for...")
  if (
    /^(and|also|what about|how about|same for|same question|and the|any of)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  // 3. Superlative & attribute query terms (price, discount, size, weight, stock, ratings)
  if (
    /\b(cheapest|cheaper|lowest\s+price|highest\s+price|most\s+expensive|best\s+value|lowest|highest|most\s+discount|biggest\s+discount|best\s+discount|on\s+sale|discounted|discounts?|marked\_down|reduced|savings|lightest|heaviest|heavier|lighter|show\s+cheaper|more\s+affordable|less\s+expensive)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  // 4. Short colour / weight / material refinements ("only blue", "16 oz", "leather")
  if (
    /^(only\s+|just\s+|in\s+)?(red|blue|black|white|green|pink|yellow|orange|purple|grey|gray|navy|leather|synthetic|vegan|\d{1,2}\s*oz)(\s+ones?)?\.?$/i.test(
      t,
    )
  ) {
    return true;
  }

  // 5. Pronoun / attribute follow-ups tied to prior product context
  if (
    /\b(them|these|those|it|that|this|ones?|both|all)\b/i.test(t) &&
    /\b(oz|ounce|size|weight|material|use|purpose|colour|color|stock|price|cheaper|cheapest|expensive|heavier|lighter|options?|available|lowest|highest|discount|discounted|discounts|sale|savings|kids?|adults?|sparring|training|competition|leather|synthetic|vegan|clean|care|warranty|rating|review|certified|beginner|professional|pro|pre.?filled|fill|filled|filling|sand|stuff|stuffing|capacity|specs?|specification|specifications|kg|lbs?)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  // 6. Direct inquiry about context items ("tell me about these", "i need to know about weight of these both")
  if (
    /\b(tell\s+me\s+about|i\s+(?:need|want)\s+to\s+know(?:\s+about)?|what\s+(?:is|are)|details?\s+(?:on|about)|can\s+i\s+(?:make|fill|add))\b.*\b(these|those|them|both|this|that|it|bag)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  // 7. Returning to earlier products ("back to the f4", "the gloves from earlier")
  if (
    /\b(back\s+to|earlier|before|again|the\s+other\s+one|from\s+before|we\s+looked\s+at)\b/i.test(
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
      /\*\*Stock:\*\*/i.test(c) ||
      /\*\*Key features\*\*/i.test(c) ||
      /\[View product\]/i.test(c) ||
      /View product:/i.test(c) ||
      /Found \*\*\d+\*\* products/i.test(c) ||
      /###\s+\*\*/i.test(c) ||
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

  // Geography / trivia / general knowledge / weather / news
  if (
    /\b(capital\s+of|who\s+is|who\s+was|when\s+was|when\s+did|what\s+is\s+the\s+capital|president\s+of|prime\s+minister)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(weather|forecast|temperature\s+outside|news\s+today|stock\s+market|lottery)\b/i.test(
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
    !/\b(products?|items?|price|cost|size|stock|colour|color|order|shipping|delivery|discount|sale|buy|purchase|gloves?|vests?|suits?|guards?|mats?|wraps?|bags?|belts?|balls?|shin|sauna|sweat|kit|bundle|boxing|mma|store|available|difference|different|compare|versus|\bvs\b|better|which|policy|policies|return|refund|warranty|exchange|vegan|leather|clean|care|rating|review|certified|beginner|professional|pro|fill|filling|sand|weight|heavier|capacity|kg|lbs|specs?|material|stuff|rdx)\b/i.test(
      t,
    ) &&
    !PRODUCT_NOUN_RE.test(t)
  ) {
    return true;
  }

  return false;
}

/** Message clearly looks like a product / shopping request. */
export function shouldForceProductSearch(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  if (isHarmfulQuery(t)) return false;

  // Broad "I need gloves/protection/equipment" → clarify first, don't force search.
  // Purchase phrasing with a specific product still forces search below.
  const broadClarify = needsProductClarification(t);
  if (broadClarify && !isPurchaseOrProductInterest(t)) return false;

  // Product follow-up questions (lowest price, cheapest, comparison) refer to existing context.
  if (isProductFollowUpQuery(t)) return false;

  // Clearer category browse (e.g. "boxing gloves", "head guards") → search now.
  if (isAmbiguousBrowseQuery(t)) return true;

  // Natural purchase / named-product interest ("I want to buy the RDX 2W…").
  if (isPurchaseOrProductInterest(t)) return true;

  if (isDiscountCodeQuery(t)) return false;
  if (isOrderTrackingIntent(t)) return false;
  if (isOffTopicQuery(t)) return false;
  if (isBareOrderNumberToken(t)) return false;
  if (isValidEmailInput(t)) return false;

  if (
    /^(hi|hello|hey|good\s+(morning|afternoon|evening)|thanks|thank you|ok|okay|bye|great|awesome|perfect|cool)\b/i.test(
      t,
    ) &&
    t.length < 40
  ) {
    return false;
  }

  if (t === "product information") return false;

  // Pure policy / shipping / store-info questions belong to the policies tool.
  if (
    /\b(ship|shipping|delivery|hours?|opening|return|refund|damaged|place\s+(an\s+)?order|policy|policies|warranty|exchange|international)\b/.test(
      t,
    ) &&
    !/\b(product|price|size|stock|colour|color|available|gloves|guard|kit|bundle|buy|purchase)\b/.test(
      t,
    )
  ) {
    return false;
  }

  // Explicit product / shopping signals.
  if (
    /\b(price|cost|how much|in stock|available|size|colour|color|variant|buy|purchase|link|url|product|products|gloves|guard|shoes|kit|bundle|shin|boxing|mma|robe|ball|looking\s+for|do\s+you\s+(?:have|sell)|show\s+me)\b/i.test(
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

  // Short catalog-style phrases ("robo kids punch") — not questions, commands, or social pleasantries.
  const words = t.split(/\s+/).filter(Boolean);
  if (
    words.length >= 2 &&
    words.length <= 6 &&
    !/[?]/.test(t) &&
    !/^(what|who|where|when|why|how|is|are|can|could|would|should|do|does|did|please|tell|track|check|order|help|i|we|my|me|great|awesome|perfect|cool|ok|okay|thanks|thank)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}
