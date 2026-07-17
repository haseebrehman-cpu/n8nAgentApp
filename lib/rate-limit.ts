/**
 * Distributed sliding-window rate limiter.
 *
 * Production: Redis ZSET + Lua (atomic, shared across all app instances).
 * Local/dev (no REDIS_URL): in-memory Map — same semantics, single process only.
 * Production with Redis configured but unavailable: fail closed (deny).
 */

import { getRedis, isRedisConfigured, redisKey } from "@/lib/redis";
import { logger } from "@/lib/logger";

const WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

export type RateLimitBucket = "chat" | "order";

const BUCKET_LIMITS: Record<RateLimitBucket, number> = {
  chat: 20,
  order: 8,
};

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  /** True when denied because Redis was required but unavailable. */
  failClosed?: boolean;
}

/**
 * Atomic sliding-window check.
 * KEYS[1] = zset key
 * ARGV[1] = nowMs, ARGV[2] = windowMs, ARGV[3] = max, ARGV[4] = memberId
 * Returns { allowed (0|1), retryAfterMs }
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
local minScore = now - window

redis.call('ZREMRANGEBYSCORE', key, 0, minScore)
local count = redis.call('ZCARD', key)

if count >= max then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestScore = tonumber(oldest[2])
  local retryAfter = window
  if oldestScore then
    retryAfter = math.max(1, oldestScore + window - now)
  end
  return {0, retryAfter}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, 0}
`;

// --- In-memory fallback (single instance) ---------------------------------

const hitLog = new Map<string, number[]>();
let lastCleanup = Date.now();

function cleanupMemory(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, timestamps] of hitLog) {
    const recent = timestamps.filter((t) => now - t < WINDOW_MS);
    if (recent.length === 0) hitLog.delete(key);
    else hitLog.set(key, recent);
  }
}

function checkRateLimitMemory(
  storageKey: string,
  maxRequests: number
): RateLimitResult {
  const now = Date.now();
  cleanupMemory(now);

  const recent = (hitLog.get(storageKey) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= maxRequests) {
    const oldest = recent[0]!;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)),
    };
  }

  recent.push(now);
  hitLog.set(storageKey, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

let loggedRedisRateLimit = false;
let loggedMemoryRateLimit = false;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

async function checkRateLimitRedis(
  clientKey: string,
  bucket: RateLimitBucket
): Promise<RateLimitResult> {
  const maxRequests = BUCKET_LIMITS[bucket];
  const redis = await getRedis();

  if (!redis) {
    // Production with REDIS_URL set but unreachable → fail closed.
    if (isProduction() && isRedisConfigured()) {
      logger.error("rate-limit", "Redis unavailable — fail closed", { bucket });
      return { allowed: false, retryAfterSeconds: 30, failClosed: true };
    }
    if (!loggedMemoryRateLimit) {
      loggedMemoryRateLimit = true;
      logger.info("rate-limit", "using in-memory (Redis unavailable)");
    }
    return checkRateLimitMemory(`${bucket}:${clientKey}`, maxRequests);
  }

  const now = Date.now();
  const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
  const key = redisKey("rl", bucket, clientKey);

  try {
    const result = (await redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      String(now),
      String(WINDOW_MS),
      String(maxRequests),
      member
    )) as [number, number];

    if (!loggedRedisRateLimit) {
      loggedRedisRateLimit = true;
      logger.info("rate-limit", "using Redis", { bucket });
    }

    const allowed = Number(result[0]) === 1;
    const retryAfterMs = Number(result[1]) || 0;
    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  } catch (err) {
    logger.error("rate-limit", "Redis error", {
      bucket,
      error: err instanceof Error ? err.message : String(err),
    });
    if (isProduction() && isRedisConfigured()) {
      return { allowed: false, retryAfterSeconds: 30, failClosed: true };
    }
    return checkRateLimitMemory(`${bucket}:${clientKey}`, maxRequests);
  }
}

export interface CheckRateLimitOptions {
  /** Logical bucket — chat LLM vs order probes. Default: chat. */
  bucket?: RateLimitBucket;
}

/** Per-client sliding window. Safe across multiple instances when Redis is configured. */
export async function checkRateLimit(
  key: string,
  options: CheckRateLimitOptions = {}
): Promise<RateLimitResult> {
  const bucket = options.bucket ?? "chat";
  return checkRateLimitRedis(key, bucket);
}
