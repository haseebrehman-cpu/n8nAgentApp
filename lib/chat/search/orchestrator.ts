/**
 * Semantic product-search orchestrator (application use-case).
 *
 * Single entry point for catalog discovery:
 *   1. Context reuse (filter lastShownProducts) when possible
 *   2. Query rewrite (typos, follow-up merge)
 *   3. Shopify MCP search (+ collection path for category totals)
 *   4. Suggest.json enrichment
 *   5. Empty/low-confidence fallbacks with broader queries
 *   6. Compact + rank + confidence metadata
 *
 * Infrastructure (MCP, storefront HTTP) is injected via imports at the edges;
 * scoring/confidence/rewrite stay pure. tool-runner is a thin adapter over this.
 */

import { logger } from "@/lib/logger";
import {
  compactCatalogMcpText,
  type CompactCatalogOptions,
} from "@/lib/shopify/compact-catalog";
import {
  fetchStorefrontCollectionsMerged,
  isCategoryStyleQuery,
  resolveCategoryCollections,
} from "@/lib/shopify/storefront-collection";
import { enrichSearchCatalogWithStorefront } from "@/lib/shopify/storefront-product-search";
import { searchCatalog } from "@/lib/shopify/storefront-mcp";
import {
  extractModelCodeFromQuery,
  isCatalogCountQuery,
  resolveCatalogResponseMode,
  type CatalogResponseMode,
} from "@/lib/chat/intent";
import {
  CATEGORY_PAYLOAD_PRODUCTS,
  COUNT_SEARCH_LIMIT,
  LIST_PAYLOAD_PRODUCTS,
  SEARCH_RESULT_LIMIT,
} from "@/lib/chat/agent/config";
import { searchCatalogForCount } from "@/lib/chat/agent/catalog-count";
import { classifySearchConfidence } from "@/lib/chat/search/confidence";
import {
  shownProductsToCatalogJson,
  tryFilterLastShownProducts,
} from "@/lib/chat/search/context-filter";
import {
  buildFallbackQueries,
  normalizeSemanticQuery,
  rewriteSearchQuery,
} from "@/lib/chat/search/query-rewrite";

/** Truncate customer queries in logs (PII / length hygiene). */
function redactQueryForLog(query: string, max = 48): string {
  const t = query.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…(${t.length}c)`;
}
import { applyCatalogPostFilters } from "@/lib/chat/search/post-filter";
import { extractBudgetMax } from "@/lib/chat/intent/journeys";
import type {
  SearchConfidence,
  SemanticSearchRequest,
  SemanticSearchResult,
} from "@/lib/chat/search/types";

function payloadCapForMode(mode: CatalogResponseMode): number | undefined {
  if (mode === "list") return LIST_PAYLOAD_PRODUCTS;
  if (mode === "category") return CATEGORY_PAYLOAD_PRODUCTS;
  return undefined;
}

function parseCompactMeta(compactJson: string): {
  productCount: number;
  topScores: number[];
  relevanceEmptied: boolean;
} {
  try {
    const obj = JSON.parse(compactJson) as {
      productCount?: number;
      products?: { relevanceScore?: number }[];
      rawHitCount?: number;
      relevanceFiltered?: boolean;
    };
    const products = Array.isArray(obj.products) ? obj.products : [];
    const productCount =
      typeof obj.productCount === "number" ? obj.productCount : products.length;
    const topScores = products
      .map((p) => (typeof p.relevanceScore === "number" ? p.relevanceScore : 0))
      .sort((a, b) => b - a);
    const relevanceEmptied =
      Boolean(obj.relevanceFiltered) &&
      productCount === 0 &&
      (obj.rawHitCount ?? 0) > 0;
    return { productCount, topScores, relevanceEmptied };
  } catch {
    return { productCount: 0, topScores: [], relevanceEmptied: false };
  }
}

function withConfidenceMeta(
  compactJson: string,
  confidence: SearchConfidence,
  fallbackApplied: boolean,
  reusedContext: boolean,
): string {
  try {
    const obj = JSON.parse(compactJson) as Record<string, unknown>;
    obj.searchConfidence = confidence;
    if (fallbackApplied) obj.fallbackApplied = true;
    if (reusedContext) obj.reusedContext = true;
    return JSON.stringify(obj);
  } catch {
    return compactJson;
  }
}

async function runMcpSearchOnce(input: {
  query: string;
  mode: CatalogResponseMode;
  availableOnly: boolean;
  counting: boolean;
  limit: number;
  signal?: AbortSignal;
}): Promise<{
  raw: string;
  collectionLabel?: string;
  exhaustedSearch?: boolean;
  skipRelevanceFilter?: boolean;
}> {
  const { query, mode, availableOnly, counting, limit, signal } = input;
  const needsExactTotal = mode === "category" || mode === "list";
  const preferCollection =
    needsExactTotal || counting || isCategoryStyleQuery(query);

  if (preferCollection) {
    let firstPage: string;
    try {
      firstPage = await searchCatalog(
        {
          query,
          pagination: { limit: COUNT_SEARCH_LIMIT },
          filters: { available: availableOnly },
        },
        { signal },
      );
    } catch (err) {
      logger.warn("semantic-search", "MCP first page failed", {
        query: redactQueryForLog(query),
        error: err instanceof Error ? err.message : String(err),
      });
      // Degrade: still try count/enrich paths below with empty seed.
      firstPage = JSON.stringify({
        products: [],
        pagination: { has_next_page: false },
      });
    }

    const modelSplit = extractModelCodeFromQuery(query);
    const collectionLookupQuery = modelSplit
      ? modelSplit.categoryQuery
      : query;

    let picked: Awaited<ReturnType<typeof resolveCategoryCollections>> = [];
    try {
      picked = await resolveCategoryCollections(
        collectionLookupQuery,
        firstPage,
        { signal },
      );
    } catch (err) {
      logger.warn("semantic-search", "collection resolve failed", {
        query: redactQueryForLog(query),
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (picked.length > 0) {
      try {
        const collectionRaw = await fetchStorefrontCollectionsMerged(
          picked.map((c) => ({ handle: c.handle, title: c.title })),
          { signal, availableOnly },
        );
        const label =
          picked.length === 1
            ? `"${picked[0]!.title}" (${picked[0]!.handle})`
            : `${picked.length} subcategory collections under "${picked[0]!.title}" (total across all matching subcategories)`;
        return {
          raw: collectionRaw,
          collectionLabel: label,
          exhaustedSearch: true,
          // Model codes still need title filter; plain categories trust membership.
          skipRelevanceFilter: !modelSplit,
        };
      } catch (err) {
        logger.warn(
          "semantic-search",
          "storefront collection fetch failed; using MCP search",
          {
            query: redactQueryForLog(query),
            handles: picked.map((c) => c.handle),
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }

    if (needsExactTotal || counting) {
      const { raw, exhausted } = await searchCatalogForCount(
        query,
        availableOnly,
        { signal },
      );
      const enriched = await enrichSearchCatalogWithStorefront(raw, query, {
        signal,
      });
      return { raw: enriched, exhaustedSearch: exhausted };
    }

    const enrichedFirst = await enrichSearchCatalogWithStorefront(
      firstPage,
      query,
      { signal },
    );
    return { raw: enrichedFirst };
  }

  const data = await searchCatalog(
    {
      query,
      pagination: { limit },
      // filters: { available: availableOnly },
    },
    { signal },
  );
  const enriched = await enrichSearchCatalogWithStorefront(data, query, {
    signal,
  });
  return { raw: enriched };
}

/**
 * Execute semantic catalog search for one tool invocation.
 */
export async function executeSemanticSearch(
  request: SemanticSearchRequest,
): Promise<SemanticSearchResult> {
  const started = Date.now();
  const lastUser = request.lastUser ?? "";

  // --- 1. Context reuse (attribute follow-ups on lastShownProducts) ---
  const contextHit = tryFilterLastShownProducts({
    lastUser,
    lastSearchQuery: request.lastSearchQuery,
    lastShownProducts: request.lastShownProducts,
  });
  if (contextHit.usable) {
    const compactJson = shownProductsToCatalogJson(
      contextHit.products,
      contextHit.effectiveQuery,
    );
    const confidence = classifySearchConfidence({
      productCount: contextHit.products.length,
    });
    logger.info("semantic-search", "reused lastShownProducts", {
      query: redactQueryForLog(contextHit.effectiveQuery),
      productCount: contextHit.products.length,
      confidence,
      ms: Date.now() - started,
    });
    return {
      compactJson: withConfidenceMeta(compactJson, confidence, false, true),
      effectiveQuery: contextHit.effectiveQuery,
      originalQuery: contextHit.effectiveQuery,
      mode: resolveCatalogResponseMode(lastUser, contextHit.effectiveQuery),
      confidence,
      productCount: contextHit.products.length,
      fallbackApplied: false,
      reusedContext: true,
    };
  }

  // --- 2. Rewrite query (typos + merge prior search) ---
  const rewritten = rewriteSearchQuery({
    toolQuery: request.query,
    lastUser,
    lastSearchQuery: request.lastSearchQuery,
  });
  const originalQuery = normalizeSemanticQuery(
    rewritten.query || request.query || lastUser,
  );
  if (!originalQuery) {
    return {
      compactJson: JSON.stringify({
        error: "query is required",
        productCount: 0,
        products: [],
        searchConfidence: "empty",
      }),
      effectiveQuery: "",
      originalQuery: "",
      mode: "generic",
      confidence: "empty",
      productCount: 0,
      fallbackApplied: false,
      reusedContext: false,
    };
  }

  const mode = resolveCatalogResponseMode(lastUser, originalQuery);
  const needsExactTotal = mode === "category" || mode === "list";
  const counting =
    needsExactTotal ||
    request.forCount === true ||
    isCatalogCountQuery(lastUser) ||
    isCatalogCountQuery(originalQuery);

  const limitRaw = Number(request.limit);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), 50)
      : counting
        ? COUNT_SEARCH_LIMIT
        : mode === "specific"
          ? 3
          : SEARCH_RESULT_LIMIT;

  const availableOnly = Boolean(request.availableOnly);
  const payloadCap = payloadCapForMode(mode);
  const softRelevance = mode === "generic";

  const compactOpts = (
    query: string,
    extra: Partial<CompactCatalogOptions> = {},
  ): CompactCatalogOptions => ({
    query,
    maxProductsInPayload:
      payloadCap ??
      (needsExactTotal || counting ? CATEGORY_PAYLOAD_PRODUCTS : undefined),
    softRelevance,
    rankByRelevance: true,
    ...extra,
  });

  // --- 3. Primary semantic search ---
  let fallbackApplied = false;
  let effectiveQuery = originalQuery;
  let collectionLabel: string | undefined;
  let compactJson: string;

  try {
    const primary = await runMcpSearchOnce({
      query: originalQuery,
      mode,
      availableOnly,
      counting,
      limit,
      signal: request.signal,
    });
    collectionLabel = primary.collectionLabel;
    compactJson = compactCatalogMcpText(
      primary.raw,
      compactOpts(originalQuery, {
        exhaustedSearch: primary.exhaustedSearch,
        skipRelevanceFilter: primary.skipRelevanceFilter,
        // Model-code collection filters stay strict.
        softRelevance: primary.skipRelevanceFilter ? false : softRelevance,
      }),
    );
  } catch (err) {
    logger.error("semantic-search", "primary search failed", {
      query: redactQueryForLog(originalQuery),
      error: err instanceof Error ? err.message : String(err),
    });
    compactJson = JSON.stringify({
      query: originalQuery,
      productCount: 0,
      products: [],
      searchConfidence: "empty",
      error: "search_failed",
    });
  }

  let meta = parseCompactMeta(compactJson);
  let confidence = classifySearchConfidence({
    productCount: meta.productCount,
    topScores: meta.topScores,
    relevanceEmptied: meta.relevanceEmptied,
  });

  // --- 4. Fallbacks for empty / low confidence (skip for exact category totals) ---
  const allowFallback = !needsExactTotal && !counting;
  if (allowFallback && (confidence === "empty" || confidence === "low")) {
    const fallbacks = buildFallbackQueries(originalQuery);
    for (const fbQuery of fallbacks) {
      if (request.signal?.aborted) break;
      try {
        const fb = await runMcpSearchOnce({
          query: fbQuery,
          mode: mode === "specific" ? "generic" : mode,
          availableOnly,
          counting: false,
          limit,
          signal: request.signal,
        });
        const fbCompact = compactCatalogMcpText(
          fb.raw,
          compactOpts(fbQuery, {
            exhaustedSearch: fb.exhaustedSearch,
            skipRelevanceFilter: fb.skipRelevanceFilter,
            softRelevance: true,
            fallbackApplied: true,
          }),
        );
        const fbMeta = parseCompactMeta(fbCompact);
        const fbConfidence = classifySearchConfidence({
          productCount: fbMeta.productCount,
          topScores: fbMeta.topScores,
          relevanceEmptied: fbMeta.relevanceEmptied,
        });
        if (fbMeta.productCount > meta.productCount) {
          compactJson = fbCompact;
          meta = fbMeta;
          confidence = fbConfidence;
          effectiveQuery = fbQuery;
          fallbackApplied = true;
          collectionLabel = fb.collectionLabel ?? collectionLabel;
          if (confidence === "high" || confidence === "partial") break;
        }
      } catch (err) {
        logger.warn("semantic-search", "fallback search failed", {
          query: redactQueryForLog(fbQuery),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Force suggest.json recovery when still empty (abbreviations / partial names).
  if (allowFallback && meta.productCount === 0) {
    try {
      const emptySeed = JSON.stringify({
        products: [],
        pagination: { has_next_page: false },
      });
      const enriched = await enrichSearchCatalogWithStorefront(
        emptySeed,
        originalQuery,
        { signal: request.signal, force: true },
      );
      const retryCompact = compactCatalogMcpText(
        enriched,
        compactOpts(originalQuery, {
          softRelevance: true,
          fallbackApplied: true,
        }),
      );
      const retryMeta = parseCompactMeta(retryCompact);
      if (retryMeta.productCount > 0) {
        compactJson = retryCompact;
        meta = retryMeta;
        confidence = classifySearchConfidence({
          productCount: retryMeta.productCount,
          topScores: retryMeta.topScores,
        });
        fallbackApplied = true;
        effectiveQuery = originalQuery;
      }
    } catch (err) {
      logger.warn("semantic-search", "empty-result enrich retry failed", {
        query: redactQueryForLog(originalQuery),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Sale / budget correctness — never show over-budget or non-sale when asked.
  const budgetMax =
    request.budgetMax ?? extractBudgetMax(lastUser) ?? undefined;
  const onSaleOnly =
    request.onSaleOnly === true ||
    /\b(on\s+sale|sale\s+items?|products?\s+on\s+sale|clearance)\b/i.test(
      lastUser,
    );
  if (budgetMax != null || onSaleOnly) {
    const posted = applyCatalogPostFilters(compactJson, {
      budgetMax,
      onSaleOnly,
    });
    if (posted.productCount > 0 || meta.productCount === 0) {
      compactJson = posted.json;
      meta = parseCompactMeta(compactJson);
      confidence = classifySearchConfidence({
        productCount: meta.productCount,
        topScores: meta.topScores,
      });
    }
  }

  compactJson = withConfidenceMeta(
    compactJson,
    confidence,
    fallbackApplied,
    false,
  );

  logger.info("semantic-search", "search complete", {
    originalQuery: redactQueryForLog(originalQuery),
    effectiveQuery: redactQueryForLog(effectiveQuery),
    mode,
    confidence,
    productCount: meta.productCount,
    fallbackApplied,
    mergedFromContext: rewritten.mergedFromContext,
    collectionLabel: collectionLabel ?? null,
    ms: Date.now() - started,
  });

  return {
    compactJson,
    effectiveQuery,
    originalQuery,
    mode,
    confidence,
    productCount: meta.productCount,
    fallbackApplied,
    reusedContext: false,
    collectionLabel,
  };
}
