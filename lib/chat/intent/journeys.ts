/**
 * Ecommerce customer-journey intent detection.
 *
 * Merchandising journeys set preference/filter signals — they do NOT rewrite
 * to hardcoded store-specific product queries.
 */

export type JourneyKind =
  | "greeting"
  | "thanks"
  | "goodbye"
  | "best_sellers"
  | "new_arrivals"
  | "trending"
  | "on_sale"
  | "gift"
  | "beginner"
  | "professional"
  | "accessories"
  | "alternatives"
  | "fbt"
  | "budget"
  | "order_cancel"
  | "order_modify"
  | "address_change"
  | "contact_support"
  | null;

export interface JourneyMatch {
  kind: Exclude<JourneyKind, null>;
  /**
   * Optional search hint derived from the customer's own words (never a
   * hardcoded category/product string from the store taxonomy).
   */
  searchQuery?: string;
  /** Max price in major units when a budget was parsed (e.g. 35 for "under £35"). */
  budgetMax?: number;
  experience?: "beginner" | "intermediate" | "professional";
  onSaleOnly?: boolean;
}

/** Social openers — no catalog search. */
export function isGreeting(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(hi|hello|hey|hiya|good\s+(morning|afternoon|evening)|howdy)(\s+there)?[!.,\s]*$/i.test(
    t,
  );
}

export function isThanks(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(thanks|thank\s+you|thx|ty|cheers|appreciate\s+it)([!.,\s]|a\s+lot|so\s+much)*$/i.test(
    t,
  );
}

export function isGoodbye(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(bye|goodbye|good\s+bye|see\s+ya|see\s+you|later|take\s+care|that'?s\s+all|all\s+good)[!.,\s]*$/i.test(
    t,
  );
}

/** Post-purchase actions the chat cannot perform — hand off / policy. */
export function isOrderCancelRequest(text: string): boolean {
  return /\b(cancel\s+(?:my\s+|the\s+|an\s+)?order|order\s+cancellation|can\s+i\s+cancel)\b/i.test(
    text,
  );
}

export function isOrderModifyRequest(text: string): boolean {
  return /\b(change|modify|edit|update)\s+(?:my\s+|the\s+)?order\b|\b(add|remove)\s+(?:an?\s+)?(?:item|product)\s+to\s+(?:my\s+)?order\b|\bchange\s+(?:the\s+)?(?:size|colour|color|quantity)\s+on\s+(?:my\s+)?order\b/i.test(
    text,
  );
}

export function isAddressChangeRequest(text: string): boolean {
  return /\b(change|update|correct|wrong)\s+(?:my\s+|the\s+)?(?:shipping\s+|delivery\s+)?address\b|\b(?:ship|deliver)\s+to\s+a\s+different\s+address\b/i.test(
    text,
  );
}

export function isContactSupportRequest(text: string): boolean {
  return /\b(contact\s+support|contact\s+you|email\s+support|support\s+email|phone\s+number|customer\s+care|how\s+do\s+i\s+contact)\b/i.test(
    text,
  );
}

/** Parse "under £35" / "below $40" → major-unit max. */
export function extractBudgetMax(text: string): number | null {
  const m = text.match(
    /\b(?:under|below|less\s+than|up\s+to|max(?:imum)?)\s*[£$€]?\s*(\d+(?:\.\d{1,2})?)\b/i,
  );
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Strip journey cue words so the remaining text can be used as a search hint.
 */
function customerSearchHint(text: string): string {
  return text
    .replace(
      /\b(best\s*sellers?|best\s*selling|new\s*arrivals?|trending|on\s+sale|clearance|gift\s+ideas?|recommend(?:ation)?s?|for\s+beginners?|beginner|professional|pro\s+level)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve the primary ecommerce journey for this turn.
 * Order matters: social → post-purchase → merchandising → null.
 */
export function resolveCustomerJourney(text: string): JourneyMatch | null {
  const t = text.trim();
  if (!t) return null;

  if (isGreeting(t)) return { kind: "greeting" };
  if (isThanks(t)) return { kind: "thanks" };
  if (isGoodbye(t)) return { kind: "goodbye" };

  if (isOrderCancelRequest(t)) return { kind: "order_cancel" };
  if (isOrderModifyRequest(t)) return { kind: "order_modify" };
  if (isAddressChangeRequest(t)) return { kind: "address_change" };
  if (isContactSupportRequest(t)) return { kind: "contact_support" };

  const lower = t.toLowerCase();
  const hint = customerSearchHint(t);

  if (
    /\b(best\s*sellers?|best\s*selling|top\s+sellers?|most\s+popular\s+products?)\b/i.test(
      lower,
    )
  ) {
    return { kind: "best_sellers", searchQuery: hint || "best sellers" };
  }

  if (/\b(new\s*arrivals?|just\s+in|latest\s+products?|newest)\b/i.test(lower)) {
    return { kind: "new_arrivals", searchQuery: hint || "new arrivals" };
  }

  if (/\b(trending|what'?s\s+hot|popular\s+right\s+now)\b/i.test(lower)) {
    return { kind: "trending", searchQuery: hint || "trending" };
  }

  if (
    /\b(on\s+sale|sale\s+items?|products?\s+on\s+sale|clearance|reduced\s+price)\b/i.test(
      lower,
    )
  ) {
    return {
      kind: "on_sale",
      searchQuery: hint || t,
      onSaleOnly: true,
    };
  }

  if (
    /\b(gift|present)\b/i.test(lower) &&
    /\b(for|idea|recommend|suggestion|christmas|birthday|him|her|dad|mum|mom|partner)\b/i.test(
      lower,
    )
  ) {
    return { kind: "gift", searchQuery: hint || t };
  }

  if (/\b(beginner|beginners|starter|i'?m\s+new|new\s+to)\b/i.test(lower)) {
    return {
      kind: "beginner",
      searchQuery: hint || t,
      experience: "beginner",
    };
  }

  if (
    /\b(professional|pro\s+level|competition\s+grade|advanced|i\s+compete)\b/i.test(
      lower,
    )
  ) {
    return {
      kind: "professional",
      searchQuery: hint || t,
      experience: "professional",
    };
  }

  if (
    /\b(accessor(?:y|ies)|what\s+else|go\s+with\s+(?:it|these|them)|pair\s+with)\b/i.test(
      lower,
    )
  ) {
    return { kind: "accessories", searchQuery: hint || "accessories" };
  }

  if (
    /\b(frequently\s+bought\s+together|bought\s+together|customers?\s+also\s+bought|complete\s+the\s+set)\b/i.test(
      lower,
    )
  ) {
    return { kind: "fbt", searchQuery: hint || t };
  }

  if (
    /\b(alternative|alternatives|similar\s+to|something\s+like|instead\s+of|other\s+options?)\b/i.test(
      lower,
    )
  ) {
    return { kind: "alternatives", searchQuery: t };
  }

  const budgetMax = extractBudgetMax(t);
  if (budgetMax != null) {
    return {
      kind: "budget",
      searchQuery: hint || t,
      budgetMax,
    };
  }

  return null;
}

/** Journeys that should force a catalog search on the first tool round. */
export function journeyForcesCatalogSearch(kind: JourneyKind): boolean {
  return (
    kind === "best_sellers" ||
    kind === "new_arrivals" ||
    kind === "trending" ||
    kind === "on_sale" ||
    kind === "gift" ||
    kind === "beginner" ||
    kind === "professional" ||
    kind === "accessories" ||
    kind === "fbt" ||
    kind === "alternatives" ||
    kind === "budget"
  );
}
