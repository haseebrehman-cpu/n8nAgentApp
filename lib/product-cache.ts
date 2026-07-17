/**
 * Two-layer product cache + cross-instance request coalescing.
 *
 * 1. Search index: normalized keyword → product IDs
 * 2. Product payload: Shopify product ID → ProductSummary
 * 3. Negative-cache empty searches briefly
 * 4. Coalesce concurrent identical misses (in-process + Redis lock with owner token)
 */

import { createHash, randomBytes } from "crypto";
import { getRedisConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { getRedis, redisKey } from "@/lib/redis";
import type { ProductSummary } from "@/lib/types";

/** Must exceed Shopify multi-query fetch time (15s × retries). */
const LOCK_TTL_SECONDS = 60;
const LOCK_WAIT_MS = 8_000;
const LOCK_POLL_MS = 50;

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "with",
  "and",
  "or",
  "for",
  "of",
  "in",
  "to",
  "set",
  "ft",
  "what",
  "is",
  "are",
  "how",
  "much",
  "price",
  "cost",
  "costs",
  "this",
  "that",
  "please",
  "me",
  "my",
  "do",
  "you",
  "have",
  "got",
  "show",
  "tell",
  "about",
  "info",
  "information",
]);

const inflight = new Map<string, Promise<ProductSummary[]>>();

export function normalizeKeyword(keyword: string): string {
  const tokens = keyword
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

  return [...new Set(tokens)].sort().join(" ");
}

function cacheFingerprint(
  keyword: string,
  limit: number,
  marketCountry: string | null
): string {
  const normalized = normalizeKeyword(keyword) || normalizeKeywordLoose(keyword);
  const raw = `${normalized}|${limit}|${marketCountry ?? ""}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function normalizeKeywordLoose(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, " ");
}

function searchKey(fingerprint: string): string {
  return redisKey("product", "search", fingerprint);
}

function lockKey(fingerprint: string): string {
  return redisKey("product", "lock", fingerprint);
}

const PRODUCT_CACHE_SCHEMA = "v3";

function productByIdKey(productId: string, marketCountry: string | null): string {
  const idHash = createHash("sha256").update(productId).digest("hex").slice(0, 24);
  return redisKey(
    "product",
    "by-id",
    PRODUCT_CACHE_SCHEMA,
    marketCountry ?? "_",
    idHash
  );
}

function isProductSummary(value: unknown): value is ProductSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ProductSummary).id === "string" &&
    typeof (value as ProductSummary).title === "string" &&
    typeof (value as ProductSummary).handle === "string"
  );
}

async function readSearchIds(fingerprint: string): Promise<{
  ids: string[] | null;
  legacyProducts: ProductSummary[] | null;
}> {
  const redis = await getRedis();
  if (!redis) return { ids: null, legacyProducts: null };

  try {
    const raw = await redis.get(searchKey(fingerprint));
    if (raw == null) return { ids: null, legacyProducts: null };

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { ids: null, legacyProducts: null };

    if (parsed.length === 0) {
      return { ids: [], legacyProducts: null };
    }

    if (parsed.every((x) => typeof x === "string")) {
      return { ids: parsed as string[], legacyProducts: null };
    }

    if (parsed.every(isProductSummary)) {
      return { ids: null, legacyProducts: parsed as ProductSummary[] };
    }

    return { ids: null, legacyProducts: null };
  } catch (err) {
    logger.error("product-cache", "search read failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ids: null, legacyProducts: null };
  }
}

async function readProductsByIds(
  ids: string[],
  marketCountry: string | null
): Promise<ProductSummary[] | null> {
  if (ids.length === 0) return [];

  const redis = await getRedis();
  if (!redis) return null;

  try {
    const keys = ids.map((id) => productByIdKey(id, marketCountry));
    const rows = await redis.mget(...keys);
    const products: ProductSummary[] = [];

    for (let i = 0; i < ids.length; i++) {
      const raw = rows[i];
      if (raw == null) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (!isProductSummary(parsed) || parsed.id !== ids[i]) {
        return null;
      }
      products.push(parsed);
    }

    return products;
  } catch (err) {
    logger.error("product-cache", "by-id read failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function writeSearchAndProducts(
  fingerprint: string,
  products: ProductSummary[],
  marketCountry: string | null
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  const { productCacheTtlSeconds, productCacheEmptyTtlSeconds } = getRedisConfig();
  const searchTtl =
    products.length === 0 ? productCacheEmptyTtlSeconds : productCacheTtlSeconds;
  const productTtl = productCacheTtlSeconds;

  try {
    const pipeline = redis.pipeline();

    if (products.length === 0) {
      pipeline.set(searchKey(fingerprint), JSON.stringify([]), "EX", searchTtl);
    } else {
      const ids = products.map((p) => p.id);
      pipeline.set(searchKey(fingerprint), JSON.stringify(ids), "EX", searchTtl);
      for (const product of products) {
        pipeline.set(
          productByIdKey(product.id, marketCountry),
          JSON.stringify(product),
          "EX",
          productTtl
        );
      }
    }

    const results = await pipeline.exec();
    if (results?.some(([err]) => err != null)) {
      logger.warn("product-cache", "pipeline partial failure");
    }
  } catch (err) {
    logger.error("product-cache", "write failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function resolveFromCache(
  fingerprint: string,
  marketCountry: string | null
): Promise<ProductSummary[] | null> {
  const { ids, legacyProducts } = await readSearchIds(fingerprint);
  if (legacyProducts !== null) return legacyProducts;
  if (ids === null) return null;
  return readProductsByIds(ids, marketCountry);
}

async function acquireLock(fingerprint: string): Promise<string | null> {
  const redis = await getRedis();
  if (!redis) {
    // No Redis → single-process singleflight only; treat as acquired.
    return randomBytes(16).toString("hex");
  }

  const token = randomBytes(16).toString("hex");
  try {
    const ok = await redis.set(
      lockKey(fingerprint),
      token,
      "EX",
      LOCK_TTL_SECONDS,
      "NX"
    );
    return ok === "OK" ? token : null;
  } catch {
    // Do not pretend every instance holds the lock on Redis errors.
    return null;
  }
}

async function releaseLock(fingerprint: string, token: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.eval(RELEASE_LOCK_LUA, 1, lockKey(fingerprint), token);
  } catch {
    // lock TTL will expire
  }
}

async function waitForCache(
  fingerprint: string,
  marketCountry: string | null,
  timeoutMs: number
): Promise<ProductSummary[] | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = await resolveFromCache(fingerprint, marketCountry);
    if (hit !== null) return hit;
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
  }
  return null;
}

/**
 * Cached product search. `fetcher` is the Shopify (or other) lookup.
 * Waiters that lose the lock never stampede — they re-read cache or return [].
 */
export async function cachedProductSearch(
  keyword: string,
  limit: number,
  marketCountry: string | null,
  fetcher: () => Promise<ProductSummary[]>
): Promise<ProductSummary[]> {
  const fingerprint = cacheFingerprint(keyword, limit, marketCountry);

  const cached = await resolveFromCache(fingerprint, marketCountry);
  if (cached !== null) return cached;

  const existing = inflight.get(fingerprint);
  if (existing) return existing;

  const promise = (async () => {
    const lockToken = await acquireLock(fingerprint);
    if (!lockToken) {
      const fromPeer = await waitForCache(fingerprint, marketCountry, LOCK_WAIT_MS);
      if (fromPeer !== null) return fromPeer;
      // Soft-fail: do not stampede Shopify when lock wait times out.
      logger.warn("product-cache", "lock wait timeout — returning empty");
      return [];
    }

    try {
      const again = await resolveFromCache(fingerprint, marketCountry);
      if (again !== null) return again;

      logger.debug("product-cache", "MISS — fetching Shopify", { fingerprint });
      const products = await fetcher();
      await writeSearchAndProducts(fingerprint, products, marketCountry);
      return products;
    } finally {
      await releaseLock(fingerprint, lockToken);
    }
  })();

  inflight.set(fingerprint, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(fingerprint);
  }
}

/** Cache key helper for discounted product lists. */
export function discountCacheFingerprint(
  limit: number,
  marketCountry: string | null
): string {
  return cacheFingerprint(`__discounted__`, limit, marketCountry);
}

export async function cachedDiscountedProducts(
  limit: number,
  marketCountry: string | null,
  fetcher: () => Promise<ProductSummary[]>
): Promise<ProductSummary[]> {
  return cachedProductSearch("__discounted__", limit, marketCountry, fetcher);
}
