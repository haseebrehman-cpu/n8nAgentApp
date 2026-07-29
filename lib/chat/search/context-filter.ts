/**
 * Reuse previously shown products for attribute / price follow-ups.
 *
 * "only blue ones", "16 oz", "show cheaper ones" should filter session memory
 * whenever possible instead of starting a brand-new catalog search.
 */

import type { ShownProduct } from "@/lib/chat/context/product-memory";
import {
  isSearchRefinement,
  mergeRefinementIntoQuery,
  normalizeSemanticQuery,
} from "@/lib/chat/search/query-rewrite";
import { matchTermsForQuery } from "@/lib/shopify/compact-catalog";

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

function titleMatchesRefinement(
  title: string,
  refinementTerms: string[],
): boolean {
  const lower = title.toLowerCase();
  return refinementTerms.every((term) => {
    if (COLOUR_TERMS.has(term)) {
      return new RegExp(`(^|[^a-z])${term}([^a-z]|$)`, "i").test(lower);
    }
    if (/^\d+$/.test(term)) {
      return new RegExp(`\\b${term}\\s*oz\\b|\\b${term}oz\\b`, "i").test(lower);
    }
    if (term === "oz" || term === "ounce") return /\b\d{1,2}\s*oz\b/i.test(lower);
    return new RegExp(`(^|[^a-z0-9])${term}`, "i").test(lower);
  });
}

/** Parse major-unit amount from formatted prices like "£32.99" / "$40.00". */
export function parsePriceAmount(price: string | null | undefined): number | null {
  if (!price) return null;
  const m = String(price).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isCheaperFollowUp(lastUser: string): boolean {
  return /\b(cheaper|cheapest|lowest\s+price|more\s+affordable|less\s+expensive|show\s+cheaper|budget)\b/i.test(
    lastUser,
  );
}

/**
 * Keep the cheaper half of shown products (by parsed price), sorted ascending.
 * Falls back to full list sorted by price when fewer than 2 priced items exist.
 */
function filterCheaperProducts(shown: ShownProduct[]): ShownProduct[] {
  const priced = shown
    .map((p) => ({ p, amount: parsePriceAmount(p.price) }))
    .filter((x): x is { p: ShownProduct; amount: number } => x.amount != null);

  if (priced.length === 0) return [];

  priced.sort((a, b) => a.amount - b.amount);
  if (priced.length === 1) return [priced[0]!.p];

  const median = priced[Math.floor(priced.length / 2)]!.amount;
  const cheaper = priced.filter((x) => x.amount <= median).map((x) => x.p);
  return cheaper.length > 0 ? cheaper : priced.map((x) => x.p);
}

export interface ContextFilterResult {
  /** Filtered products from lastShownProducts. */
  products: ShownProduct[];
  /** Effective query describing the filter (for session memory). */
  effectiveQuery: string;
  /** True when we should skip MCP and return these products. */
  usable: boolean;
}

/**
 * Try to satisfy an attribute or price follow-up from lastShownProducts.
 */
export function tryFilterLastShownProducts(input: {
  lastUser: string;
  lastSearchQuery?: string | null;
  lastShownProducts?: ShownProduct[] | null;
}): ContextFilterResult {
  const shown = input.lastShownProducts ?? [];
  const prior = input.lastSearchQuery?.trim() ?? "";
  const lastUser = input.lastUser.trim();

  if (shown.length === 0) {
    return { products: [], effectiveQuery: "", usable: false };
  }

  // --- Price follow-up on the previous shortlist / comparison ---
  if (isCheaperFollowUp(lastUser)) {
    const cheaper = filterCheaperProducts(shown);
    if (cheaper.length === 0) {
      return { products: [], effectiveQuery: "", usable: false };
    }
    const effectiveQuery = prior
      ? normalizeSemanticQuery(`cheaper ${prior}`)
      : "cheaper options from previous results";
    return { products: cheaper, effectiveQuery, usable: true };
  }

  // Attribute refinements: prefer merge with prior query, but colour/oz can
  // filter titles even when lastSearchQuery is missing.
  const canRefine =
    Boolean(prior) && isSearchRefinement(lastUser, prior)
      ? true
      : /^(only\s+|just\s+|in\s+)?(red|blue|black|white|green|pink|yellow|orange|purple|grey|gray|navy|leather|synthetic|vegan|\d{1,2}\s*oz)(\s+ones?)?\.?$/i.test(
          lastUser,
        );

  if (!canRefine) {
    return { products: [], effectiveQuery: "", usable: false };
  }

  const effectiveQuery = prior
    ? mergeRefinementIntoQuery(lastUser, prior)
    : normalizeSemanticQuery(lastUser);

  // Apparel / glove size letters (S, M, L, XL…) plus colour/oz/material.
  const sizeTokens = lastUser
    .toLowerCase()
    .match(/\b(xxs|xs|s|m|l|xl|xxl|xxxl|small|medium|large)\b/g);

  const refTerms = [
    ...matchTermsForQuery(normalizeSemanticQuery(lastUser)).filter(
      (t) =>
        COLOUR_TERMS.has(t) ||
        /^\d+$/.test(t) ||
        t === "oz" ||
        [
          "leather",
          "synthetic",
          "vegan",
          "beginner",
          "kids",
          "kid",
          "sparring",
          "training",
          "competition",
        ].includes(t),
    ),
    ...(sizeTokens ?? []).map((s) => s.toLowerCase()),
  ];

  if (refTerms.length === 0) {
    return { products: [], effectiveQuery, usable: false };
  }

  const matched = shown.filter((p) =>
    titleMatchesRefinement(p.title, refTerms),
  );

  if (matched.length === 0) {
    return { products: [], effectiveQuery, usable: false };
  }

  return {
    products: matched,
    effectiveQuery,
    usable: true,
  };
}

/**
 * Build a compacted catalog-shaped JSON string from ShownProduct memory
 * so the model receives the same shape as search_catalog.
 */
export function shownProductsToCatalogJson(
  products: ShownProduct[],
  query: string,
): string {
  return JSON.stringify({
    query,
    productCount: products.length,
    products: products.map((p) => ({
      id: p.id,
      title: p.title,
      url: p.url,
      price: p.price,
      wasPrice: p.wasPrice,
      onSale: p.onSale,
      inStock: p.inStock,
      summary: null,
      variants: [],
      options: [],
    })),
    rawHitCount: products.length,
    relevanceFiltered: true,
    matchedKind: null,
    countIsExactCategoryTotal: false,
    hasMore: false,
    searchConfidence: products.length >= 3 ? "high" : "partial",
    fallbackApplied: false,
    reusedContext: true,
  });
}
