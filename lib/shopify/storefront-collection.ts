/**
 * Resolve a shopper category query to a real storefront collection, then load
 * that collection's full membership from the public products.json endpoint.
 *
 * Why: MCP free-text search over-counts (e.g. 23 "head guard" titles) while the
 * live Boxing → Head Guards page is a specific collection (17 products).
 * Admin GraphQL is intentionally not used for catalog; this uses the same
 * public storefront collection data the website shows.
 *
 * Candidates come from the store's full collection directory rather than from
 * the `collections` array on MCP search hits — MCP caps that array at 5 entries
 * per product, so real nav categories (Kids Boxing Sets) were invisible while
 * promo collections (Clearance Sale, Iconic Gear) took the slots. MCP hit counts
 * are still used, but only as a relevance tie-break between candidates.
 *
 * A query resolves to the single collection that best matches it — the store's
 * own category page is already the category total. Merging sibling
 * subcategories is only a fallback for when the directory is unavailable.
 */

import {
  getStoreCollections,
  isMarketingCollection,
  queryRequestsMarketingCollection,
  type StoreCollection,
} from "@/lib/shopify/collection-directory";
import {
  expandCategoryCompoundsForMatch,
  extractProductTerms,
  matchTermsForQuery,
  singularizeToken,
  titleHasTermForMatch,
} from "@/lib/shopify/compact-catalog";
import { logger } from "@/lib/logger";
import { fetchStorefrontJson } from "@/lib/shopify/storefront-json";
import { storefrontCatalogOrigin } from "@/lib/shopify/storefront-origin";

export { storefrontCatalogOrigin };

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
  "plain",
  "basic",
  "simple",
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

/**
 * Words that carry no category meaning when comparing a collection title to a
 * shopper query ("Boxing Gloves & Pads" vs "boxing gloves").
 */
const TITLE_NOISE_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "our",
  "shop",
  "collection",
  "range",
  "equipment",
  "sports",
  "sport",
]);

/** Comparable token signature for a collection title or a query. */
function categoryTokenKey(text: string): string {
  const tokens = expandCategoryCompoundsForMatch(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularizeToken)
    .filter((t) => t.length >= 2 && !TITLE_NOISE_WORDS.has(t));
  return [...new Set(tokens)].sort().join(" ");
}

function titleTokens(title: string): string[] {
  return [
    ...new Set(
      expandCategoryCompoundsForMatch(title)
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map(singularizeToken)
        .filter((t) => t.length >= 2 && !TITLE_NOISE_WORDS.has(t)),
    ),
  ];
}

/** True when the collection title says exactly what the shopper asked for. */
export function isExactCategoryTitleMatch(
  title: string,
  terms: string[],
): boolean {
  if (terms.length === 0) return false;
  return categoryTokenKey(title) === categoryTokenKey(terms.join(" "));
}

function scoreCollection(
  title: string,
  handle: string,
  terms: string[],
  hitCount: number,
  query: string,
): number {
  if (!collectionMatchesQueryTerms(title, handle, terms)) return 0;

  // Promo / seasonal / brand-campaign collections cut across the category tree.
  if (
    isMarketingCollection(title, handle) &&
    !queryRequestsMarketingCollection(query)
  ) {
    return 0;
  }

  let score = 100 + hitCount * 10;
  const haystack = collectionHaystack(title, handle);
  const q = query.toLowerCase();

  // The store's own category page for this exact phrase is the right answer.
  if (isExactCategoryTitleMatch(title, terms)) score += 1_000;

  // Otherwise prefer the tightest title — "Punch Bags" over "Punch Bags & Mitts Sets".
  const termSet = new Set(terms);
  const extraTitleTokens = titleTokens(title).filter(
    (t) => !termSet.has(t),
  ).length;
  score -= extraTitleTokens * 12;

  // Prefer collections that share distinctive query tokens already counted
  // above — boost any named department token present in both query and title.
  if (/\bkids?\b/i.test(q)) {
    if (/\bkids?\b/i.test(haystack)) score += 40;
    else score -= 20;
  }
  for (const term of terms) {
    if (term.length < 3) continue;
    if (
      /^(glove|guard|bag|mat|wrap|shoe|boot|belt|pad|strap|block|head|shin|mouth|hand|punch)s?$/i.test(
        term,
      )
    ) {
      continue;
    }
    if (haystack.includes(term)) score += 40;
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
  if (
    isMarketingCollection(title, handle) &&
    !queryRequestsMarketingCollection(query)
  ) {
    return false;
  }

  // Kids gear is its own subcategory unless the shopper asked for kids.
  if (!/\bkids?\b/i.test(q) && /\bkids?\b/i.test(haystack)) {
    return false;
  }
  if (/\bkids?\b/i.test(q) && !/\bkids?\b/i.test(haystack)) {
    return false;
  }

  // When the shopper names a department token, keep collections rooted in that
  // department (handle/title prefix) — works for any future department name.
  const distinctive = terms.filter(
    (term) =>
      term.length >= 3 &&
      !/^(glove|guard|bag|mat|wrap|shoe|boot|belt|pad|strap|block|head|shin|mouth|hand|punch|set|kit)s?$/i.test(
        term,
      ),
  );
  if (distinctive.length > 0) {
    const primary = distinctive[0]!;
    const titleLower = title.toLowerCase();
    const rooted =
      handle === primary ||
      handle.startsWith(`${primary}-`) ||
      titleLower === primary ||
      titleLower.startsWith(`${primary} `) ||
      titleLower.startsWith(`${primary}-`);
    return rooted && distinctive.every((term) => haystack.includes(term));
  }

  // No distinctive department token — allow any non-marketing term match.
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

interface CollectionCandidate {
  handle: string;
  title: string;
  hitCount: number;
}

/** Score, drop non-matches, and order candidates best-first. */
function rankCollections(
  candidates: Iterable<CollectionCandidate>,
  query: string,
  terms: string[],
): PickedCollection[] {
  const scored: PickedCollection[] = [];
  for (const entry of candidates) {
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
  scored.sort((a, b) => b.score - a.score || b.hitCount - a.hitCount);
  return scored;
}

/**
 * From an MCP search payload, pick matching storefront collection(s).
 *
 * Fallback path only — MCP truncates each product's `collections` array to 5,
 * so this sees an incomplete and promo-skewed candidate set. Prefer
 * resolveCategoryCollections, which uses the full collection directory.
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

  const scored = rankCollections(tallies.values(), query, terms);
  if (scored.length === 0) return [];

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

/** Rank the store's real collections for a query, ignoring MCP entirely. */
export function pickCategoryCollectionsFromDirectory(
  directory: StoreCollection[],
  query: string,
  hitCounts: Map<string, number> = new Map(),
): PickedCollection[] {
  const terms = matchTermsForQuery(query);
  if (terms.length < 2) return [];

  const candidates: CollectionCandidate[] = directory
    .filter((c) => c.productsCount > 0)
    .map((c) => ({
      handle: c.handle,
      title: c.title,
      hitCount: hitCounts.get(c.handle) ?? 0,
    }));

  return rankCollections(candidates, query, terms);
}

/**
 * Resolve a category query to the storefront collection(s) that answer it.
 *
 * The directory is authoritative: a category resolves to the single collection
 * whose title best matches the query, because the store's own category page is
 * already the category total. Sibling subcategories are merged only when the
 * directory is unavailable and we have to fall back to MCP-derived candidates.
 */
export async function resolveCategoryCollections(
  query: string,
  rawMcpJson: string,
  options: { signal?: AbortSignal } = {},
): Promise<PickedCollection[]> {
  const directory = await getStoreCollections({ signal: options.signal });

  if (directory.length > 0) {
    const tallies = tallyCollectionsFromMcp(rawMcpJson);
    const hitCounts = new Map<string, number>();
    for (const entry of tallies?.values() ?? []) {
      hitCounts.set(entry.handle, entry.hitCount);
    }

    const ranked = pickCategoryCollectionsFromDirectory(
      directory,
      query,
      hitCounts,
    );
    if (ranked.length > 0) {
      logger.info("storefront-collection", "resolved category collection", {
        query,
        handle: ranked[0]!.handle,
        score: ranked[0]!.score,
        runnerUp: ranked[1]?.handle ?? null,
        candidates: ranked.length,
      });
      return [ranked[0]!];
    }
  }

  return pickCategoryCollectionsFromMcpSearch(rawMcpJson, query);
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
    const data = await fetchStorefrontJson<{ products?: AjaxProduct[] }>(
      url,
      `collection ${handle}`,
      options.signal,
    );
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

  // Sequential: products.json rate limits per IP, and a 429 here would change
  // the reported category total by forcing a different counting path.
  const payloads: string[] = [];
  for (const c of collections) {
    payloads.push(
      await fetchStorefrontCollectionProducts(c.handle, {
        signal: options.signal,
        availableOnly: options.availableOnly,
        collectionTitle: c.title,
      }),
    );
  }

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
