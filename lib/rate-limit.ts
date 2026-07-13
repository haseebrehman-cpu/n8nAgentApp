/**
 * In-memory sliding-window rate limiter, keyed by client IP.
 *
 * Suitable for a single server instance. If you deploy multiple
 * instances/regions, replace with a shared store (Redis/Upstash)
 * behind the same checkRateLimit signature.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

const hitLog = new Map<string, number[]>();
let lastCleanup = Date.now();

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, timestamps] of hitLog) {
    const recent = timestamps.filter((t) => now - t < WINDOW_MS);
    if (recent.length === 0) hitLog.delete(key);
    else hitLog.set(key, recent);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  cleanup(now);

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
