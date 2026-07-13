/**
 * Distributed sliding-window rate limiter.
 *
 * Production: Redis ZSET + Lua (atomic, shared across all app instances).
 * Local/dev (no REDIS_URL): in-memory Map — same semantics, single process only.
 *
 * Signature stays checkRateLimit(key) → RateLimitResult (now async).
 */

import { getRedis, redisKey } from "@/lib/redis";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
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

function checkRateLimitMemory(key: string): RateLimitResult {
  const now = Date.now();
  cleanupMemory(now);

  const recent = (hitLog.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldest = recent[0];
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)),
    };
  }

  recent.push(now);
  hitLog.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

// --- Redis ----------------------------------------------------------------

let loggedRedisRateLimit = false;
let loggedMemoryRateLimit = false;

async function checkRateLimitRedis(clientKey: string): Promise<RateLimitResult> {
  const redis = await getRedis();
  if (!redis) {
    if (!loggedMemoryRateLimit) {
      loggedMemoryRateLimit = true;
      console.log("[rate-limit] using in-memory (Redis unavailable)");
    }
    return checkRateLimitMemory(clientKey);
  }

  const now = Date.now();
  const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
  const key = redisKey("rl", "chat", clientKey);

  try {
    const result = (await redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      String(now),
      String(WINDOW_MS),
      String(MAX_REQUESTS_PER_WINDOW),
      member
    )) as [number, number];

    if (!loggedRedisRateLimit) {
      loggedRedisRateLimit = true;
      console.log(`[rate-limit] using Redis (key ${key.replace(/:[^:]+$/, ":*")})`);
    }

    const allowed = Number(result[0]) === 1;
    const retryAfterMs = Number(result[1]) || 0;
    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  } catch (err) {
    console.error(
      "[rate-limit] Redis error, falling back to in-memory:",
      err instanceof Error ? err.message : err
    );
    return checkRateLimitMemory(clientKey);
  }
}

/** Per-client sliding window (20 req / 60s). Safe across multiple instances when Redis is configured. */
export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  return checkRateLimitRedis(key);
}
