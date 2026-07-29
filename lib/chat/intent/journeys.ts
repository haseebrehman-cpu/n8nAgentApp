/**
 * Ecommerce customer-journey intent detection.
 *
 * Maps realistic shopper asks (best sellers, gifts, cancel order, greeting…)
 * onto a small set of journey kinds so the agent can route, rewrite searches,
 * or return deterministic sales-floor replies.
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
  /** Canonical semantic search query when the journey needs catalog retrieval. */
  searchQuery?: string;
  /** Max price in major units when a budget was parsed (e.g. 35 for "under £35"). */
  budgetMax?: number;
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

  if (
    /\b(best\s*sellers?|best\s*selling|top\s+sellers?|most\s+popular\s+products?)\b/i.test(
      lower,
    )
  ) {
    return { kind: "best_sellers", searchQuery: "best sellers" };
  }

  if (/\b(new\s*arrivals?|just\s+in|latest\s+products?|newest)\b/i.test(lower)) {
    return { kind: "new_arrivals", searchQuery: "new arrivals" };
  }

  if (/\b(trending|what'?s\s+hot|popular\s+right\s+now)\b/i.test(lower)) {
    return { kind: "trending", searchQuery: "trending" };
  }

  if (
    /\b(on\s+sale|sale\s+items?|products?\s+on\s+sale|clearance|reduced\s+price)\b/i.test(
      lower,
    )
  ) {
    return { kind: "on_sale", searchQuery: "products on sale" };
  }

  if (
    /\b(gift|present)\b/i.test(lower) &&
    /\b(for|idea|recommend|suggestion|christmas|birthday|him|her|dad|mum|mom|partner)\b/i.test(
      lower,
    )
  ) {
    return { kind: "gift", searchQuery: normalizeGiftQuery(t) };
  }

  if (
    /\b(beginner|beginners|starter|new\s+to\s+(?:boxing|mma|training))\b/i.test(
      lower,
    )
  ) {
    return {
      kind: "beginner",
      searchQuery: /\bgloves?\b/i.test(lower)
        ? "beginner boxing gloves"
        : "beginner boxing kit",
    };
  }

  if (
    /\b(professional|pro\s+level|competition\s+grade|advanced)\b/i.test(lower) &&
    /\b(glove|guard|recommend|gear|kit|product)\b/i.test(lower)
  ) {
    return {
      kind: "professional",
      searchQuery: /\bgloves?\b/i.test(lower)
        ? "competition boxing gloves"
        : "professional boxing gear",
    };
  }

  if (
    /\b(accessor(?:y|ies)|what\s+else|go\s+with\s+(?:it|these|them)|pair\s+with|hand\s+wraps?\s+too)\b/i.test(
      lower,
    )
  ) {
    // "gloves and accessories like wraps…" is a glove-first kit ask — do not
    // rewrite catalog search to wraps/mouthguard only. Pure add-on follow-ups
    // ("what else", "go with these") still use the accessories journey.
    const gloveFirstKit =
      /\bgloves?\b/i.test(lower) &&
      /\baccessor(?:y|ies)\b/i.test(lower) &&
      lower.search(/\bgloves?\b/i) < lower.search(/\baccessor/i) &&
      !/\b(what\s+else|go\s+with|pair\s+with|hand\s+wraps?\s+too)\b/i.test(
        lower,
      );
    if (!gloveFirstKit) {
      return { kind: "accessories", searchQuery: "hand wraps mouthguard" };
    }
  }

  if (
    /\b(frequently\s+bought\s+together|bought\s+together|customers?\s+also\s+bought|complete\s+the\s+set)\b/i.test(
      lower,
    )
  ) {
    return {
      kind: "fbt",
      searchQuery: "boxing accessories hand wraps mouthguard",
    };
  }

  if (
    /\b(alternative|alternatives|similar\s+to|something\s+like|instead\s+of|other\s+options?)\b/i.test(
      lower,
    )
  ) {
    return { kind: "alternatives", searchQuery: t };
  }

  const budgetMax = extractBudgetMax(t);
  if (budgetMax != null && /\b(glove|guard|bag|recommend|budget|cheap)\b/i.test(lower)) {
    // Keep budget journey, but do not pass a full kit laundry-list as the
    // search query — primary product focus happens in query rewrite too.
    return {
      kind: "budget",
      searchQuery: t,
      budgetMax,
    };
  }

  return null;
}

function normalizeGiftQuery(text: string): string {
  const t = text.trim();
  if (/\b(boxing|mma|fitness|yoga)\b/i.test(t)) {
    return `${t} gift`;
  }
  return "gifts boxing gloves";
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
