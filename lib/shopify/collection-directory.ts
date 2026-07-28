/**
 * The store's authoritative collection list, loaded from the public
 * /collections.json endpoint and cached.
 *
 * Why this exists: Shopify's Storefront MCP truncates each product's
 * `collections` array to 5 entries, and promo collections (Clearance Sale,
 * RDX Discount, Sale Picks…) routinely occupy those slots. Deriving category
 * candidates from MCP search hits therefore misses real nav categories — e.g.
 * "kids boxing sets" never saw the Kids Boxing Sets collection, so it fell back
 * to free-text title matching and listed discontinued promo products instead.
 *
 * The directory is the same data the storefront navigation is built from, so
 * matching against it gives category totals that agree with the website.
 */

import { getRedisConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { getRedis, redisKey } from "@/lib/redis";
import { fetchStorefrontJson } from "@/lib/shopify/storefront-json";
import { storefrontCatalogOrigin } from "@/lib/shopify/storefront-origin";

export interface StoreCollection {
  handle: string;
  title: string;
  /** Published product count reported by the storefront. */
  productsCount: number;
}

/** collections.json max page size. */
const PAGE_SIZE = 250;
/** Safety cap; 250 * 8 = 2000 collections. */
const MAX_PAGES = 8;

/**
 * Marketing / seasonal / brand-campaign collections. These cut across the real
 * category tree, so they must never win a plain category query: "Iconic Gear"
 * (324 products) and "New Arrival — MMA" (278) would otherwise swamp any
 * genuine nav collection. Selected only when the shopper names them.
 */
const MARKETING_COLLECTION_PATTERNS: RegExp[] = [
  /\bsale\b/,
  /\bdeals?\b/,
  /\bclearance\b/,
  /\bdiscounts?\b/,
  /\boffers?\b/,
  /\bbest[\s-]?sellers?\b/,
  /\bbest[\s-]?selling\b/,
  /\bpicks?\b/,
  /\bfeatured\b/,
  /\btrending\b/,
  /\bpopular\b/,
  /\bnew[\s-]?arrivals?\b/,
  /\bgifts?\b/,
  /\biconic\b/,
  /\bexclusives?\b/,
  /\bbundles?\b/,
  /\bmothers?[\s-]?day\b/,
  /\bfathers?[\s-]?day\b/,
  /\bvalentines?\b/,
  /\beaster\b/,
  /\bchristmas\b/,
  /\bxmas\b/,
  /\bhalloween\b/,
  /\bblack[\s-]?friday\b/,
  /\bcyber[\s-]?monday\b/,
  /\bboxing[\s-]?day\b/,
  /\bextra[\s-]?category\b/,
  /\ball[\s-]?products?\b/,
  /\bhomepage\b/,
  /\bfrontpage\b/,
];

function marketingHaystack(title: string, handle: string): string {
  return `${title} ${handle.replace(/-/g, " ")}`.toLowerCase();
}

/** True for promo / seasonal / brand-campaign collections. */
export function isMarketingCollection(title: string, handle: string): boolean {
  const haystack = marketingHaystack(title, handle);
  // "Boxing Day" must not swallow every boxing collection.
  if (/\bboxing\b/.test(haystack) && !/\bboxing[\s-]?day\b/.test(haystack)) {
    return MARKETING_COLLECTION_PATTERNS.filter(
      (re) => re.source !== "\\bboxing[\\s-]?day\\b",
    ).some((re) => re.test(haystack));
  }
  return MARKETING_COLLECTION_PATTERNS.some((re) => re.test(haystack));
}

/** True when the shopper explicitly asked for a promo / campaign collection. */
export function queryRequestsMarketingCollection(query: string): boolean {
  const q = query.toLowerCase();
  return MARKETING_COLLECTION_PATTERNS.some((re) => re.test(q));
}

interface CachedDirectory {
  collections: StoreCollection[];
  expiresAt: number;
}

const globalForDirectory = globalThis as unknown as {
  __n8nappCollectionDirectory?: CachedDirectory;
};

interface RawCollection {
  handle?: string;
  title?: string;
  products_count?: number;
}

async function fetchCollectionsFromStorefront(
  signal?: AbortSignal,
): Promise<StoreCollection[]> {
  const origin = storefrontCatalogOrigin();
  const collections: StoreCollection[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await fetchStorefrontJson<{ collections?: RawCollection[] }>(
      `${origin}/collections.json?limit=${PAGE_SIZE}&page=${page}`,
      "collections.json",
      signal,
    );
    const batch = Array.isArray(data.collections) ? data.collections : [];
    if (batch.length === 0) break;

    for (const node of batch) {
      const handle = String(node.handle ?? "").trim();
      const title = String(node.title ?? "").trim();
      if (!handle || seen.has(handle)) continue;
      seen.add(handle);
      collections.push({
        handle,
        title: title || handle,
        productsCount: Number.isFinite(node.products_count)
          ? Number(node.products_count)
          : 0,
      });
    }

    if (batch.length < PAGE_SIZE) break;
  }

  return collections;
}

/**
 * Every collection published on the storefront, cached in Redis (shared across
 * instances) and in-process for the TTL. Returns [] when the storefront is
 * unreachable so callers can fall back to MCP-derived candidates.
 */
export async function getStoreCollections(
  options: { signal?: AbortSignal } = {},
): Promise<StoreCollection[]> {
  const now = Date.now();
  const memo = globalForDirectory.__n8nappCollectionDirectory;
  if (memo && memo.expiresAt > now) return memo.collections;

  const { productCacheTtlSeconds } = getRedisConfig();
  const cacheKey = redisKey("collections", storefrontCatalogOrigin());

  const redis = await getRedis().catch(() => null);
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as StoreCollection[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          globalForDirectory.__n8nappCollectionDirectory = {
            collections: parsed,
            expiresAt: now + productCacheTtlSeconds * 1000,
          };
          return parsed;
        }
      }
    } catch (err) {
      logger.warn("collection-directory", "redis read failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let collections: StoreCollection[];
  try {
    collections = await fetchCollectionsFromStorefront(options.signal);
  } catch (err) {
    logger.warn("collection-directory", "storefront collections fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Serve a stale memo rather than losing category resolution entirely.
    return memo?.collections ?? [];
  }

  if (collections.length === 0) return memo?.collections ?? [];

  globalForDirectory.__n8nappCollectionDirectory = {
    collections,
    expiresAt: now + productCacheTtlSeconds * 1000,
  };

  if (redis) {
    try {
      await redis.set(
        cacheKey,
        JSON.stringify(collections),
        "EX",
        productCacheTtlSeconds,
      );
    } catch (err) {
      logger.warn("collection-directory", "redis write failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("collection-directory", "loaded storefront collections", {
    count: collections.length,
  });

  return collections;
}

/** Test seam: drop the in-process memo. */
export function resetCollectionDirectoryCache(): void {
  globalForDirectory.__n8nappCollectionDirectory = undefined;
}
