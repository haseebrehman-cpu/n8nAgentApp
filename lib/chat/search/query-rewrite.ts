/**
 * Query normalization and conversation-aware rewrite for semantic search.
 *
 * Responsibility: turn a customer turn (+ prior search memory) into the best
 * free-text query for Shopify MCP — preserving intent (use-case, colour,
 * weight, budget) rather than collapsing to bare keywords.
 */

import {
  isCatalogCountQuery,
  isExplicitCatalogListQuery,
  normalizeSearchQuery,
} from "@/lib/chat/intent";
import { QUERY_TYPO_MAP } from "@/lib/chat/intent/patterns";
import { matchTermsForQuery } from "@/lib/shopify/compact-catalog";

/** Body-part modifiers that must stay with "guard" in fallback queries. */
const GUARD_TYPE_FALLBACK_MODIFIERS = new Set([
  "head",
  "shin",
  "groin",
  "mouth",
  "face",
  "chest",
  "body",
]);

/** Extra typos applied token-wise (beyond whole-phrase QUERY_TYPO_MAP). */
const TOKEN_TYPO_MAP: Record<string, string> = {
  ...QUERY_TYPO_MAP,
  glovs: "gloves",
  glovea: "gloves",
  sparrin: "sparring",
  sparringg: "sparring",
  beginer: "beginner",
  begginer: "beginner",
  beginnner: "beginner",
  lether: "leather",
  synethic: "synthetic",
  blu: "blue",
  gren: "green",
  blk: "black",
  gry: "grey",
};

/** Words that alone are refinements, not standalone catalog queries. */
const REFINEMENT_STOP = new Set([
  "only",
  "ones",
  "one",
  "the",
  "a",
  "an",
  "in",
  "for",
  "me",
  "please",
  "just",
  "show",
  "those",
  "these",
  "them",
  "that",
  "this",
  "something",
  "similar",
  "like",
  "to",
  "under",
  "over",
  "best",
]);

const COLOUR_TERMS = new Set([
  "red",
  "blue",
  "black",
  "white",
  "green",
  "pink",
  "yellow",
  "orange",
  "purple",
  "grey",
  "gray",
  "gold",
  "silver",
  "brown",
  "navy",
  "camo",
]);

/** Core shoppable gear — when listed first in a kit ask, this is the search target. */
const CORE_PRODUCT_PHRASES: { kind: string; re: RegExp; label: string }[] = [
  {
    kind: "glove",
    re: /\b(?:\w+\s+)?gloves?\b/i,
    label: "gloves",
  },
  {
    kind: "mitt",
    re: /\b(?:focus\s+|punch\s+)?mitts?\b/i,
    label: "mitts",
  },
  {
    kind: "shoe",
    re: /\b(?:\w+\s+)?shoes?\b/i,
    label: "shoes",
  },
  {
    kind: "boot",
    re: /\b(?:\w+\s+)?boots?\b/i,
    label: "boots",
  },
  {
    kind: "vest",
    re: /\b(?:\w+\s+)?vests?\b/i,
    label: "vests",
  },
  { kind: "short", re: /\bshorts?\b/i, label: "shorts" },
  { kind: "robe", re: /\brobes?\b/i, label: "robes" },
  { kind: "mat", re: /\b(?:\w+\s+)?mats?\b/i, label: "mats" },
  { kind: "strap", re: /\b(?:\w+\s+)?straps?\b/i, label: "straps" },
];

/** Add-ons that must not steal ranking from the primary product in kit queries. */
const ACCESSORY_PRODUCT_PHRASES: { kind: string; re: RegExp }[] = [
  { kind: "wrap", re: /\b(?:hand\s+)?wraps?\b/i },
  {
    kind: "head_guard",
    re: /\bhead[\s-]?guards?\b|\bheadguards?\b|\bhead[\s-]?gears?\b/i,
  },
  {
    kind: "mouth_guard",
    re: /\bmouth[\s-]?guards?\b|\bmouthguards?\b/i,
  },
  {
    kind: "shin_guard",
    re: /\bshin[\s-]?guards?\b|\bshinguards?\b/i,
  },
  {
    kind: "groin_guard",
    re: /\bgroin[\s-]?guards?\b|\bgroinguards?\b/i,
  },
  { kind: "bag", re: /\b(?:gym\s+|kit\s+|sports?\s+)?bags?\b/i },
  { kind: "pad", re: /\b(?:thai\s+|kick\s+|belly\s+)?pads?\b/i },
];

type KindSpan = { kind: string; index: number; isCore: boolean };

function findKindSpans(query: string): KindSpan[] {
  const spans: KindSpan[] = [];
  for (const p of CORE_PRODUCT_PHRASES) {
    const m = p.re.exec(query);
    if (m && m.index != null) {
      spans.push({ kind: p.kind, index: m.index, isCore: true });
    }
  }
  for (const p of ACCESSORY_PRODUCT_PHRASES) {
    const m = p.re.exec(query);
    if (m && m.index != null) {
      spans.push({ kind: p.kind, index: m.index, isCore: false });
    }
  }
  spans.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  return spans.filter((s) => {
    if (seen.has(s.kind)) return false;
    seen.add(s.kind);
    return true;
  });
}

/**
 * When a shopper asks for a main product PLUS accessories (wraps, head guard,
 * bag…), search must target the primary product — not the last noun in the list.
 * Otherwise ranking/filter treat "gym bag" / "head guard" as the kind and bury gloves.
 */
export function focusPrimaryProductQuery(query: string): string {
  const q = query.trim().replace(/\s+/g, " ");
  if (!q) return q;

  const spans = findKindSpans(q);
  const primary = spans[0];
  if (!primary?.isCore) return q;
  if (!spans.some((s) => !s.isCore && s.index > primary.index)) return q;

  // Drop explicit accessory trailers ("with matching wraps, head guard…").
  let focused = q
    .replace(/\bwith\s+matching\b[\s\S]*$/i, " ")
    .replace(
      /\band\s+(?:also\s+)?(?:need|want|get|looking\s+for)\b[\s\S]*$/i,
      " ",
    )
    .replace(/\bplus\b[\s\S]*$/i, " ")
    .replace(/\bincluding\b[\s\S]*$/i, " ")
    .trim();

  // Strip remaining accessory phrases so they can't become the relevance "kind".
  for (const p of ACCESSORY_PRODUCT_PHRASES) {
    focused = focused.replace(p.re, " ");
  }

  focused = focused
    .replace(/\b(?:with|and|plus|,)\s*$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (focused.length < 8) {
    const core = CORE_PRODUCT_PHRASES.find((p) => p.kind === primary.kind);
    return normalizeSemanticQuery(core?.label ?? "gloves");
  }

  return normalizeSemanticQuery(focused);
}

/**
 * Apply whole-phrase + per-token typo correction, then store taxonomy synonyms.
 */
export function normalizeSemanticQuery(query: string): string {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;

  const lower = trimmed.toLowerCase();
  if (QUERY_TYPO_MAP[lower]) {
    return normalizeSearchQuery(QUERY_TYPO_MAP[lower]);
  }

  const tokenFixed = trimmed
    .split(/\s+/)
    .map((tok) => {
      const clean = tok.toLowerCase().replace(/[^a-z0-9]/g, "");
      return TOKEN_TYPO_MAP[clean] ?? tok;
    })
    .join(" ");

  return normalizeSearchQuery(tokenFixed);
}

/**
 * True when the current message looks like a short attribute refinement
 * ("only blue ones", "16 oz", "leather") rather than a fresh product ask.
 */
export function isSearchRefinement(
  lastUser: string,
  lastSearchQuery?: string | null,
): boolean {
  if (!lastSearchQuery?.trim()) return false;
  const t = lastUser.trim().toLowerCase();
  if (!t || t.length > 80) return false;

  // "show cheaper ones" is a refinement of the previous shortlist, not discovery.
  if (/\b(cheaper|cheapest|more\s+affordable|less\s+expensive)\b/i.test(t)) {
    return true;
  }

  // Explicit new discovery — not a refinement.
  if (
    /\b(show|find|search|looking\s+for|do\s+you\s+(?:have|sell)|recommend|similar\s+to)\b/i.test(
      t,
    ) &&
    matchTermsForQuery(t).length >= 2 &&
    !/\b(cheaper|cheapest)\b/i.test(t)
  ) {
    return false;
  }

  const terms = matchTermsForQuery(t);
  if (terms.length === 0) return false;
  if (terms.length > 4) return false;

  // Weight / colour / material / skill-level only.
  const allRefinement = terms.every(
    (term) =>
      COLOUR_TERMS.has(term) ||
      /^\d+$/.test(term) ||
      term === "oz" ||
      term === "ounce" ||
      [
        "leather",
        "synthetic",
        "vegan",
        "beginner",
        "pro",
        "professional",
        "kids",
        "kid",
        "adult",
        "sparring",
        "training",
        "competition",
        "cheap",
        "cheapest",
        "budget",
      ].includes(term) ||
      REFINEMENT_STOP.has(term),
  );

  if (allRefinement) return true;

  // "only blue", "blue ones", "in red"
  if (
    /^(only\s+|just\s+|in\s+)?[a-z0-9\s£$]+(ones?|please)?$/i.test(t) &&
    terms.length <= 3
  ) {
    return true;
  }

  return false;
}

/**
 * Merge a short refinement into the prior search query, preserving semantic
 * context (e.g. last="sparring gloves", user="only blue ones" → "blue sparring gloves").
 */
export function mergeRefinementIntoQuery(
  lastUser: string,
  lastSearchQuery: string,
): string {
  const prior = normalizeSemanticQuery(lastSearchQuery);
  const refinement = normalizeSemanticQuery(lastUser);
  const priorTerms = new Set(matchTermsForQuery(prior));
  const refTerms = matchTermsForQuery(refinement).filter(
    (t) => !REFINEMENT_STOP.has(t) && !priorTerms.has(t),
  );

  if (refTerms.length === 0) return prior;

  // Put new attributes first so "blue sparring gloves" reads naturally.
  return normalizeSemanticQuery(`${refTerms.join(" ")} ${prior}`);
}

/**
 * Rewrite the tool query using customer message + session search memory.
 */
export function rewriteSearchQuery(input: {
  toolQuery: string;
  lastUser: string;
  lastSearchQuery?: string | null;
}): { query: string; mergedFromContext: boolean } {
  const toolQ = normalizeSemanticQuery(input.toolQuery || "");
  const userQ = normalizeSemanticQuery(input.lastUser || "");
  const prior = input.lastSearchQuery
    ? normalizeSemanticQuery(input.lastSearchQuery)
    : "";

  // Prefer the richer of tool vs user when both look like product queries.
  let base = toolQ || userQ;
  if (
    userQ &&
    toolQ &&
    matchTermsForQuery(userQ).length > matchTermsForQuery(toolQ).length
  ) {
    base = userQ;
  }

  if (prior && isSearchRefinement(input.lastUser, prior)) {
    return {
      query: focusPrimaryProductQuery(
        mergeRefinementIntoQuery(input.lastUser, prior),
      ),
      mergedFromContext: true,
    };
  }

  // Count / list / bare "yes" with no product nouns → reuse the prior category
  // ("how many total available list all" after shin guards).
  if (
    prior &&
    matchTermsForQuery(prior).length >= 1 &&
    matchTermsForQuery(base).length === 0 &&
    (isCatalogCountQuery(input.lastUser) ||
      isExplicitCatalogListQuery(input.lastUser) ||
      /^(yes|yeah|yep|yup|ok|okay|sure)\b/i.test(input.lastUser.trim()))
  ) {
    return {
      query: focusPrimaryProductQuery(prior),
      mergedFromContext: true,
    };
  }

  // "something similar to X" — keep full intent phrase for MCP semantics.
  if (/\bsimilar\b/i.test(input.lastUser) && userQ) {
    return {
      query: focusPrimaryProductQuery(userQ),
      mergedFromContext: false,
    };
  }

  return {
    query: focusPrimaryProductQuery(base),
    mergedFromContext: false,
  };
}

/**
 * Progressive broader queries for empty/low-confidence fallbacks.
 * Strips budget → colour → skill/use modifiers, keeping product type.
 */
export function buildFallbackQueries(query: string): string[] {
  const q = focusPrimaryProductQuery(normalizeSemanticQuery(query));
  if (!q) return [];

  const variants: string[] = [];
  const seen = new Set<string>([q.toLowerCase()]);

  const push = (next: string) => {
    const n = normalizeSemanticQuery(next);
    const key = n.toLowerCase();
    if (!n || seen.has(key)) return;
    seen.add(key);
    variants.push(n);
  };

  // 1. Drop budget / price constraints
  push(
    q
      .replace(
        /\b(under|below|less\s+than|over|above|more\s+than)\s*[£$€]?\s*\d+(?:\.\d+)?\b/gi,
        " ",
      )
      .replace(/\b[£$€]\s*\d+(?:\.\d+)?\b/gi, " "),
  );

  // 2. Drop colour terms
  push(
    q
      .replace(
        /\b(red|blue|black|white|green|pink|yellow|orange|purple|grey|gray|gold|silver|brown|navy|camo)\b/gi,
        " ",
      )
      .replace(/\s+/g, " "),
  );

  // 3. Keep product-type core (last 1–2 meaningful terms + model codes)
  const terms = matchTermsForQuery(q);
  const model = terms.find((t) => /^[a-z]{0,3}\d{1,4}[a-z]{0,3}$/i.test(t));
  const kind = terms.includes("glove")
    ? "glove"
    : terms[terms.length - 1];
  const guardMod = terms.find((t) => GUARD_TYPE_FALLBACK_MODIFIERS.has(t));
  if (model && kind && model !== kind) {
    push(
      kind === "guard" && guardMod ? `${model} ${guardMod} guards` : `${model} ${kind}`,
    );
  } else if (kind) {
    // Keep distinctive modifiers when present; never invent a default sport.
    const sportMod = terms.find(
      (t) =>
        t !== kind &&
        t.length > 2 &&
        !["guard", "glove", "bag", "mat"].includes(t),
    );
    if (kind === "guard" && guardMod) {
      push(`${guardMod} guards`);
    } else if (sportMod && kind === "glove") {
      push(`${sportMod} gloves`);
    } else {
      push(kind === "glove" ? "gloves" : kind);
    }
  }

  return variants.slice(0, 3);
}
