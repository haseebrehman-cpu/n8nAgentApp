/**
 * Resolve storefront category collections discovered via MCP search, then load
 * the full collection membership from the public products.json endpoint.
 *
 * Why: MCP free-text search over-counts (e.g. 23 "head guard" titles) while the
 * live Boxing → Head Guards page is a specific collection (17 products).
 * Admin GraphQL is intentionally not used for catalog; this uses the same
 * public storefront collection data the website shows.
 *
 * Parent category queries (e.g. "boxing gloves") merge every matching
 * subcategory collection so productCount is the full category total. Scoped
 * queries (e.g. "training boxing gloves") still pick one best collection.
 */

import { getShopifyConfig } from "@/lib/config";
import {
  expandCategoryCompoundsForMatch,
  extractProductTerms,
  matchTermsForQuery,
  titleHasTermForMatch,
} from "@/lib/shopify/compact-catalog";
import { logger } from "@/lib/logger";

export interface PickedCollection {
  handle: string;
  title: string;
  score: number;
  hitCount: number;
}

/**
 * Use-case / audience modifiers that narrow a parent category to one
 * subcategory (e.g. "training boxing gloves" → training only).
 */
const SUBCATEGORY_SCOPE_MODIFIERS = new Set([
  "training",
  "sparring",
  "competition",
  "fight",
  "bag",
  "kids",
  "kid",
  "junior",
  "youth",
  "women",
  "woman",
  "mens",
  "men",
  "beginner",
  "pro",
  "professional",
]);

/** True when the query names a subcategory / use-case, not the parent category. */
export function isScopedSubcategoryQuery(query: string): boolean {
  const terms = extractProductTerms(query);
  return terms.some((t) => SUBCATEGORY_SCOPE_MODIFIERS.has(t));
}

interface McpCollectionRef {
  title?: string;
  handle?: string;
}

interface McpProductRef {
  collections?: McpCollectionRef[];
}

/** Storefront origin used for /collections/{handle}/products.json */
export function storefrontCatalogOrigin(): string {
  const { storefrontUrl, domain } = getShopifyConfig();
  if (storefrontUrl) {
    try {
      return new URL(storefrontUrl).origin;
    } catch {
      // fall through
    }
  }
  return `https://${domain}`;
}

function collectionHaystack(title: string, handle: string): string {
  return expandCategoryCompoundsForMatch(
    `${title} ${handle.replace(/-/g, " ")}`,
  );
}

/**
 * Whether a collection title/handle matches the shopper category terms.
 * Treats "Headgear" collections as head+guard (store menu naming).
 */
export function collectionMatchesQueryTerms(
  title: string,
  handle: string,
  terms: string[],
): boolean {
  if (terms.length === 0) return false;
  const haystack = collectionHaystack(title, handle);

  if (terms.includes("head") && terms.includes("guard")) {
    const isHeadgearCategory =
      /\bhead[\s-]?gears?\b|\bheadgears?\b|\bhead[\s-]?guards?\b|\bheadguards?\b/i.test(
        haystack,
      );
    if (!isHeadgearCategory) return false;
    const rest = terms.filter((t) => t !== "head" && t !== "guard");
    return rest.every((t) => titleHasTermForMatch(haystack, t));
  }

  return terms.every((t) => titleHasTermForMatch(haystack, t));
}

function scoreCollection(
  title: string,
  handle: string,
  terms: string[],
  hitCount: number,
  query: string,
): number {
  if (!collectionMatchesQueryTerms(title, handle, terms)) return 0;

  let score = 100 + hitCount * 10;
  const haystack = collectionHaystack(title, handle);
  const q = query.toLowerCase();

  // Prefer primary nav categories over promo / seasonal collections.
  if (/\b(sale|deal|mothers?|bestseller|gift)\b/i.test(haystack)) {
    score -= 80;
  }

  if (/\bkids?\b/i.test(q)) {
    if (/\bkids?\b/i.test(haystack)) score += 40;
    else score -= 20;
  } else if (/\bmma\b/i.test(q)) {
    if (/\bmma\b/i.test(haystack)) score += 40;
    else score -= 10;
  } else if (/\bboxing\b/i.test(q) || (terms.includes("head") && terms.includes("guard"))) {
    // Default "head guards" / "boxing headgear" → Boxing menu collection.
    if (/\bboxing\b/i.test(haystack)) score += 40;
    if (/\bmma\b/i.test(haystack)) score -= 15;
  }

  // Prefer tighter, dedicated category handles.
  const handleParts = handle.split("-").filter(Boolean).length;
  score -= Math.max(0, handleParts - 4);

  return score;
}

/** Whether a collection belongs in a parent-category union for this query. */
function collectionFitsParentAggregation(
  title: string,
  handle: string,
  query: string,
  terms: string[],
): boolean {
  const haystack = collectionHaystack(title, handle);
  const q = query.toLowerCase();

  // Promo / seasonal collections inflate or skew category totals.
  if (/\b(sale|deal|mothers?|bestseller|gift)\b/i.test(haystack)) {
    return false;
  }

  // Kids gear is its own subcategory unless the shopper asked for kids.
  if (!/\bkids?\b/i.test(q) && /\bkids?\b/i.test(haystack)) {
    return false;
  }
  if (/\bkids?\b/i.test(q) && !/\bkids?\b/i.test(haystack)) {
    return false;
  }

  const queryHasMma = /\bmma\b/i.test(q);
  const queryHasBoxing = /\bboxing\b/i.test(q);

  if (queryHasMma && !queryHasBoxing) {
    return /\bmma\b/i.test(haystack);
  }
  if (queryHasBoxing && !queryHasMma) {
    return !/\bmma\b/i.test(haystack);
  }

  // Bare "head guards" defaults to the Boxing menu collection, not MMA.
  if (terms.includes("head") && terms.includes("guard")) {
    return /\bboxing\b/i.test(haystack) && !/\bmma\b/i.test(haystack);
  }

  return true;
}

function tallyCollectionsFromMcp(
  rawMcpJson: string,
): Map<string, { handle: string; title: string; hitCount: number }> | null {
  let parsed: { products?: McpProductRef[] };
  try {
    parsed = JSON.parse(rawMcpJson) as { products?: McpProductRef[] };
  } catch {
    return null;
  }

  const tallies = new Map<
    string,
    { handle: string; title: string; hitCount: number }
  >();

  for (const product of parsed.products ?? []) {
    for (const col of product.collections ?? []) {
      const handle = String(col.handle ?? "").trim();
      const title = String(col.title ?? "").trim();
      if (!handle) continue;
      const prev = tallies.get(handle);
      if (prev) {
        prev.hitCount += 1;
      } else {
        tallies.set(handle, { handle, title: title || handle, hitCount: 1 });
      }
    }
  }

  return tallies;
}

/**
 * From an MCP search payload, pick matching storefront collection(s).
 *
 * - Parent queries ("boxing gloves"): every matching subcategory collection
 *   (so totals span training + competition + sparring, etc.).
 * - Scoped queries ("training boxing gloves"): the single best collection.
 */
export function pickCategoryCollectionsFromMcpSearch(
  rawMcpJson: string,
  query: string,
): PickedCollection[] {
  const tallies = tallyCollectionsFromMcp(rawMcpJson);
  if (!tallies) return [];

  const terms = matchTermsForQuery(query);
  if (terms.length < 2) return [];

  const scored: PickedCollection[] = [];
  for (const entry of tallies.values()) {
    const score = scoreCollection(
      entry.title,
      entry.handle,
      terms,
      entry.hitCount,
      query,
    );
    if (score <= 0) continue;
    scored.push({
      handle: entry.handle,
      title: entry.title,
      score,
      hitCount: entry.hitCount,
    });
  }

  if (scored.length === 0) return [];

  scored.sort((a, b) => b.score - a.score);

  // Subcategory / use-case queries stay on one best collection.
  if (isScopedSubcategoryQuery(query)) {
    return [scored[0]!];
  }

  // Parent category: union all collections that fit the sport/audience scope.
  const aggregated = scored.filter((c) =>
    collectionFitsParentAggregation(c.title, c.handle, query, terms),
  );

  return aggregated.length > 0 ? aggregated : [scored[0]!];
}

/**
 * From an MCP search payload, pick the best matching storefront collection
 * (e.g. boxing-protective-gear-head-guards for "head guards").
 */
export function pickCategoryCollectionFromMcpSearch(
  rawMcpJson: string,
  query: string,
): PickedCollection | null {
  return pickCategoryCollectionsFromMcpSearch(rawMcpJson, query)[0] ?? null;
}

interface AjaxVariant {
  id?: number;
  title?: string;
  available?: boolean;
  price?: string;
  sku?: string;
}

interface AjaxProduct {
  id?: number;
  title?: string;
  handle?: string;
  url?: string;
  variants?: AjaxVariant[];
}

function priceToMinorUnits(price: string | undefined): number | null {
  if (!price) return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  // Ajax API returns major units ("106.99"); Admin sometimes uses cents.
  if (price.includes(".") || n < 1000) return Math.round(n * 100);
  return Math.round(n);
}

/**
 * Load every product in a storefront collection (public products.json).
 * Returns UCP-shaped JSON so compactCatalogMcpText can reuse the same path.
 */
export async function fetchStorefrontCollectionProducts(
  handle: string,
  options: {
    signal?: AbortSignal;
    availableOnly?: boolean;
    collectionTitle?: string;
  } = {},
): Promise<string> {
  const origin = storefrontCatalogOrigin();
  const availableOnly = options.availableOnly === true;
  const products: unknown[] = [];
  let page = 1;

  // products.json max page size is 250.
  for (;;) {
    const url = `${origin}/collections/${encodeURIComponent(handle)}/products.json?limit=250&page=${page}`;
    const res = await fetch(url, {
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(
        `Storefront collection fetch failed (${res.status}) for ${handle}`,
      );
    }
    const data = (await res.json()) as { products?: AjaxProduct[] };
    const batch = Array.isArray(data.products) ? data.products : [];
    if (batch.length === 0) break;

    for (const node of batch) {
      const idNum = node.id;
      const title = String(node.title ?? "").trim();
      if (!idNum || !title) continue;

      const currency = "GBP";
      const variants = (node.variants ?? []).map((v) => {
        const minor = priceToMinorUnits(v.price) ?? 0;
        return {
          id: v.id ? `gid://shopify/ProductVariant/${v.id}` : undefined,
          title: String(v.title ?? "Default"),
          sku: v.sku || undefined,
          availability: { available: Boolean(v.available) },
          price: { amount: minor, currency },
        };
      });

      const anyAvailable = variants.some((v) => v.availability.available);
      if (availableOnly && !anyAvailable) continue;

      const minMinor =
        variants.reduce<number | null>((min, v) => {
          const a = v.price.amount;
          if (min === null || a < min) return a;
          return min;
        }, null) ?? 0;

      const pathHandle = String(node.handle ?? "").trim();
      const url =
        typeof node.url === "string" && node.url.trim()
          ? node.url.startsWith("http")
            ? node.url
            : `${origin}${node.url}`
          : pathHandle
            ? `${origin}/products/${pathHandle}`
            : undefined;

      products.push({
        id: `gid://shopify/Product/${idNum}`,
        title,
        url,
        price_range: { min: { amount: minMinor, currency } },
        variants,
        collections: [
          {
            title: options.collectionTitle || handle,
            handle,
          },
        ],
      });
    }

    if (batch.length < 250) break;
    page += 1;
    if (page > 10) break;
  }

  logger.info("storefront-collection", "loaded collection products", {
    handle,
    count: products.length,
    availableOnly,
  });

  return JSON.stringify({
    products,
    pagination: { has_next_page: false },
    collection: {
      title: options.collectionTitle || handle,
      handle,
    },
  });
}

/**
 * Load and merge products from multiple storefront collections, deduped by
 * product id. Used for parent category totals across subcategories.
 */
export async function fetchStorefrontCollectionsMerged(
  collections: { handle: string; title: string }[],
  options: {
    signal?: AbortSignal;
    availableOnly?: boolean;
  } = {},
): Promise<string> {
  if (collections.length === 0) {
    return JSON.stringify({
      products: [],
      pagination: { has_next_page: false },
    });
  }

  if (collections.length === 1) {
    const only = collections[0]!;
    return fetchStorefrontCollectionProducts(only.handle, {
      signal: options.signal,
      availableOnly: options.availableOnly,
      collectionTitle: only.title,
    });
  }

  const payloads = await Promise.all(
    collections.map((c) =>
      fetchStorefrontCollectionProducts(c.handle, {
        signal: options.signal,
        availableOnly: options.availableOnly,
        collectionTitle: c.title,
      }),
    ),
  );

  const byId = new Map<string, unknown>();
  const collectionMeta: { title: string; handle: string }[] = [];

  for (let i = 0; i < payloads.length; i++) {
    const col = collections[i]!;
    collectionMeta.push({ title: col.title, handle: col.handle });
    let parsed: { products?: { id?: string }[] };
    try {
      parsed = JSON.parse(payloads[i]!) as { products?: { id?: string }[] };
    } catch {
      continue;
    }
    for (const product of parsed.products ?? []) {
      const id = String(product.id ?? "").trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, product);
    }
  }

  const products = [...byId.values()];
  const primary = collections[0]!;

  logger.info("storefront-collection", "merged collection products", {
    collections: collections.map((c) => c.handle),
    count: products.length,
    availableOnly: options.availableOnly === true,
  });

  return JSON.stringify({
    products,
    pagination: { has_next_page: false },
    collection: {
      title: primary.title,
      handle: primary.handle,
      mergedFrom: collectionMeta,
    },
  });
}

/** True when the query looks like a multi-word category browse/count. */
export function isCategoryStyleQuery(query: string): boolean {
  return extractProductTerms(query).length >= 2;
}
