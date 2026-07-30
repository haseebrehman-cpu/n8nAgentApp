/**
 * Canonical Search Cache — session-scoped freeze of search results so
 * identical customer intents reuse the same product set and ordering.
 */

import type { ConversationCatalogContext } from "@/lib/chat/context/conversation-context";
import type { ShownProduct } from "@/lib/chat/context/product-memory";
import type { SearchFilters } from "@/lib/chat/context/conversation-context";

export interface CanonicalCacheEntry {
  canonicalSearch: string;
  filterKey: string;
  products: ShownProduct[];
  totalCount: number;
  collectionHandle?: string;
  collectionTitle?: string;
}

export function buildFilterKey(filters: SearchFilters = {}): string {
  const parts: string[] = [];
  if (filters.budgetMax != null) parts.push(`b:${filters.budgetMax}`);
  if (filters.onSaleOnly) parts.push("sale:1");
  if (filters.availableOnly === false) parts.push("avail:0");
  else if (filters.availableOnly) parts.push("avail:1");
  if (filters.colour) parts.push(`c:${filters.colour.toLowerCase()}`);
  if (filters.size) parts.push(`s:${filters.size.toLowerCase()}`);
  if (filters.attributes?.length) {
    parts.push(
      `a:${[...filters.attributes].map((a) => a.toLowerCase()).sort().join(",")}`,
    );
  }
  return parts.sort().join("|") || "none";
}

export function cacheKey(canonicalSearch: string, filters?: SearchFilters): string {
  return `${canonicalSearch.trim().toLowerCase()}::${buildFilterKey(filters)}`;
}

/**
 * Return frozen products when the session context matches the canonical search
 * and filters. Otherwise null (caller must execute a live search).
 */
export function lookupCanonicalCache(
  ctx: ConversationCatalogContext | null | undefined,
  canonicalSearch: string,
  filters?: SearchFilters,
): CanonicalCacheEntry | null {
  if (!ctx?.canonicalSearch || !ctx.products.length) return null;
  const want = cacheKey(canonicalSearch, filters);
  const have = cacheKey(ctx.canonicalSearch, ctx.filters);
  if (want !== have) return null;
  return {
    canonicalSearch: ctx.canonicalSearch,
    filterKey: buildFilterKey(ctx.filters),
    products: ctx.products.map((p) => ({ ...p })),
    totalCount: ctx.totalCount,
    collectionHandle: ctx.collectionHandle,
    collectionTitle: ctx.collectionTitle,
  };
}

export function entryFromContext(
  ctx: ConversationCatalogContext,
): CanonicalCacheEntry {
  return {
    canonicalSearch: ctx.canonicalSearch,
    filterKey: buildFilterKey(ctx.filters),
    products: ctx.products.map((p) => ({ ...p })),
    totalCount: ctx.totalCount,
    collectionHandle: ctx.collectionHandle,
    collectionTitle: ctx.collectionTitle,
  };
}
