/**
 * Query normalization and conversation-aware rewrite for semantic search.
 *
 * Responsibility: turn a customer turn (+ prior search memory) into the best
 * free-text query for Shopify MCP — preserving intent (use-case, colour,
 * weight, budget) rather than collapsing to bare keywords.
 */

import { normalizeSearchQuery } from "@/lib/chat/intent";
import { QUERY_TYPO_MAP } from "@/lib/chat/intent/patterns";
import { matchTermsForQuery } from "@/lib/shopify/compact-catalog";

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
      query: mergeRefinementIntoQuery(input.lastUser, prior),
      mergedFromContext: true,
    };
  }

  // "something similar to X" — keep full intent phrase for MCP semantics.
  if (/\bsimilar\b/i.test(input.lastUser) && userQ) {
    return { query: userQ, mergedFromContext: false };
  }

  return { query: base, mergedFromContext: false };
}

/**
 * Progressive broader queries for empty/low-confidence fallbacks.
 * Strips budget → colour → skill/use modifiers, keeping product type.
 */
export function buildFallbackQueries(query: string): string[] {
  const q = normalizeSemanticQuery(query);
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
  const kind = terms[terms.length - 1];
  if (model && kind && model !== kind) {
    push(`${model} ${kind}`);
  } else if (kind) {
    // Prefer "boxing gloves" style when boxing + glove present
    if (terms.includes("boxing") && kind === "glove") {
      push("boxing gloves");
    } else if (terms.includes("mma") && kind === "glove") {
      push("mma gloves");
    } else {
      push(kind === "glove" ? "gloves" : kind);
    }
  }

  return variants.slice(0, 3);
}
