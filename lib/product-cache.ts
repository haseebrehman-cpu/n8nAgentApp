/**
 * Product search cache + cross-instance request coalescing.
 *
 * At high chat volume, identical catalog queries dominate. This layer:
 * 1. Serves hot results from Redis (short TTL so price/stock stay fresh)
 * 2. Negative-caches empty results briefly (stampede protection)
 * 3. Coalesces concurrent identical misses (in-process + Redis lock)
 */

import { createHash } from "crypto";
import { getRedisConfig } from "@/lib/config";
import { getRedis, redisKey } from "@/lib/redis";
import type { ProductSummary } from "@/lib/types";

const LOCK_TTL_SECONDS = 12;
const LOCK_WAIT_MS = 8_000;
const LOCK_POLL_MS = 50;

/** In-process singleflight map (same Node isolate). */
const inflight = new Map<string, Promise<ProductSummary[]>>();

function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheFingerprint(
  keyword: string,
  limit: number,
  marketCountry: string | null
): string {
  const raw = `${normalizeKeyword(keyword)}|${limit}|${marketCountry ?? ""}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function cacheKey(fingerprint: string): string {
  return redisKey("product", "search", fingerprint);
}

function lockKey(fingerprint: string): string {
  return redisKey("product", "lock", fingerprint);
}

async function readCache(fingerprint: string): Promise<ProductSummary[] | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    const raw = await redis.get(cacheKey(fingerprint));
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as ProductSummary[];
    if (!Array.isArray(parsed)) return null;
    console.log(
      `[product-cache] HIT ${cacheKey(fingerprint)} (${parsed.length} products)`
    );
    return parsed;
  } catch (err) {
    console.error(
      "[product-cache] read failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function writeCache(
  fingerprint: string,
  products: ProductSummary[]
): Promise<void> {
  const redis = await getRedis();
  if (!redis) {
    console.log(
      `[product-cache] skip write — Redis unavailable (would cache ${products.length} products)`
    );
    return;
  }

  const { productCacheTtlSeconds, productCacheEmptyTtlSeconds } = getRedisConfig();
  const ttl =
    products.length === 0 ? productCacheEmptyTtlSeconds : productCacheTtlSeconds;

  try {
    await redis.set(cacheKey(fingerprint), JSON.stringify(products), "EX", ttl);
    console.log(
      `[product-cache] SET ${cacheKey(fingerprint)} (${products.length} products, ttl=${ttl}s)`
    );
  } catch (err) {
    console.error(
      "[product-cache] write failed:",
      err instanceof Error ? err.message : err
    );
  }
}

async function acquireLock(fingerprint: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return true; // no Redis → caller is the only coalescer (in-process)

  try {
    const ok = await redis.set(
      lockKey(fingerprint),
      "1",
      "EX",
      LOCK_TTL_SECONDS,
      "NX"
    );
    return ok === "OK";
  } catch {
    return true; // on Redis error, proceed (prefer availability over perfect coalescing)
  }
}

async function releaseLock(fingerprint: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.del(lockKey(fingerprint));
  } catch {
    // lock TTL will expire
  }
}

async function waitForCache(
  fingerprint: string,
  timeoutMs: number
): Promise<ProductSummary[] | null> {
  const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
    const hit = await readCache(fingerprint);
    if (hit !== null) return hit;
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
  }
  return null;
}

/**
 * Cached product search. `fetcher` is the Shopify (or other) lookup.
 * Safe to call from every chat turn under high concurrency.
 */
export async function cachedProductSearch(
  keyword: string,
  limit: number,
  marketCountry: string | null,
  fetcher: () => Promise<ProductSummary[]>
): Promise<ProductSummary[]> {
  const fingerprint = cacheFingerprint(keyword, limit, marketCountry);

    const cached = await readCache(fingerprint);
  if (cached !== null) return cached;

  const existing = inflight.get(fingerprint);
  if (existing) return existing;

  const promise = (async () => {
    const gotLock = await acquireLock(fingerprint);
    if (!gotLock) {
      const fromPeer = await waitForCache(fingerprint, LOCK_WAIT_MS);
      if (fromPeer !== null) return fromPeer;
      // Peer failed or timed out — fall through and fetch ourselves
    }

    try {
      // Double-check after lock (another instance may have written)
      const again = await readCache(fingerprint);
      if (again !== null) return again;

      console.log(
        `[product-cache] MISS ${cacheKey(fingerprint)} — fetching Shopify`
      );
      const products = await fetcher();
      await writeCache(fingerprint, products);
      return products;
    } finally {
      if (gotLock) await releaseLock(fingerprint);
    }
  })();

  inflight.set(fingerprint, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(fingerprint);
  }
}
