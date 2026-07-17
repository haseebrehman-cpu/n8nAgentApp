/**
 * Shared Redis client (ioredis) for multi-instance production.
 *
 * - Singleton on globalThis so Next.js hot reload / serverless reuse one connection
 * - Supports redis:// and rediss:// (TLS) URLs
 * - Soft-fails when REDIS_URL is unset (local/dev) so the app still boots
 * - Logs connect success / failure clearly (URL redacted — never logs password)
 */

import Redis from "ioredis";
import { getRedisConfig } from "@/lib/config";

const globalForRedis = globalThis as unknown as {
  __n8nappRedis?: Redis | null;
  __n8nappRedisUrl?: string;
  __n8nappRedisReady?: boolean;
  __n8nappRedisLastError?: string | null;
};

export type RedisStatus = "connected" | "skipped" | "failed";

export interface RedisStatusReport {
  status: RedisStatus;
  /** Redacted target or reason — safe to log. */
  detail: string;
}

let lastErrorLogAt = 0;
const ERROR_LOG_COOLDOWN_MS = 15_000;

/** Safe for logs: redis(s)://***@host:port — never includes password. */
export function redactRedisUrl(url: string): string {
  try {
    const u = new URL(url);
    const auth = u.username ? "***@" : "";
    return `${u.protocol}//${auth}${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return "[invalid REDIS_URL]";
  }
}

function warnTlsIfNeeded(url: string) {
  // Redis Cloud public endpoints are often redis:// (non-TLS) on a custom port.
  // Only warn when someone uses redis:// against hosts that almost always require TLS.
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const likelyNeedsTls =
      host.includes("upstash.io") || host.includes("cache.amazonaws.com");
    if (likelyNeedsTls && u.protocol === "redis:") {
      console.warn(
        `[redis] ${redactRedisUrl(url)} usually requires TLS — try rediss://`
      );
    }
  } catch {
    // ignore
  }
}

function logError(message: string, detail?: string) {
  const full = detail ? `${message}: ${detail}` : message;
  globalForRedis.__n8nappRedisLastError = full;
  const now = Date.now();
  if (now - lastErrorLogAt < ERROR_LOG_COOLDOWN_MS) return;
  lastErrorLogAt = now;
  console.error(`[redis] ${full}`);
}

function createClient(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 5_000,
    keepAlive: 10_000,
    retryStrategy(times) {
      if (times > 20) return null;
      return Math.min(times * 100, 2_000);
    },
  });

  client.on("connect", () => {
    console.log(`[redis] TCP connected → ${redactRedisUrl(url)}`);
  });

  client.on("ready", () => {
    globalForRedis.__n8nappRedisReady = true;
    globalForRedis.__n8nappRedisLastError = null;
    console.log(`[redis] ready (PING ok) → ${redactRedisUrl(url)}`);
  });

  client.on("close", () => {
    if (globalForRedis.__n8nappRedisReady) {
      console.warn(`[redis] connection closed → ${redactRedisUrl(url)}`);
    }
    globalForRedis.__n8nappRedisReady = false;
  });

  client.on("error", (err) => {
    globalForRedis.__n8nappRedisReady = false;
    logError(`connection error (${redactRedisUrl(url)})`, err.message);
  });

  client.on("end", () => {
    globalForRedis.__n8nappRedisReady = false;
  });

  return client;
}

/**
 * Returns a connected Redis client, or null if REDIS_URL is unset / connect failed.
 * Callers must tolerate null (in-memory / no-cache fallback).
 */
export async function getRedis(): Promise<Redis | null> {
  const { url } = getRedisConfig();
  if (!url) return null;

  warnTlsIfNeeded(url);

  const existing = globalForRedis.__n8nappRedis;
  if (existing && globalForRedis.__n8nappRedisUrl === url) {
    if (existing.status === "wait") {
      try {
        await existing.connect();
      } catch (err) {
        logError(
          `connect failed (${redactRedisUrl(url)}) — using in-memory fallback`,
          err instanceof Error ? err.message : String(err)
        );
        return null;
      }
    }
    if (existing.status === "end") {
      logError(
        `client ended (${redactRedisUrl(url)}) — using in-memory fallback`
      );
      return null;
    }
    return existing;
  }

  if (existing) {
    existing.disconnect(false);
  }

  const client = createClient(url);
  globalForRedis.__n8nappRedis = client;
  globalForRedis.__n8nappRedisUrl = url;
  globalForRedis.__n8nappRedisReady = false;

  try {
    if (client.status === "wait") {
      await client.connect();
    }
    const pong = await client.ping();
    if (pong !== "PONG") {
      logError(`unexpected PING response (${redactRedisUrl(url)})`, String(pong));
      return null;
    }
    globalForRedis.__n8nappRedisReady = true;
    globalForRedis.__n8nappRedisLastError = null;
    console.log(`[redis] ready (PING ok) → ${redactRedisUrl(url)}`);
    return client;
  } catch (err) {
    logError(
      `connect/PING failed (${redactRedisUrl(url)}) — rate limit & product cache will NOT use Redis`,
      err instanceof Error ? err.message : String(err)
    );
    try {
      client.disconnect(false);
    } catch {
      // ignore
    }
    globalForRedis.__n8nappRedis = null;
    globalForRedis.__n8nappRedisReady = false;
    return null;
  }
}

/**
 * Probe Redis for this request and return a clear status.
 * Always safe to call from the chat route — never throws.
 */
export async function probeRedisStatus(): Promise<RedisStatusReport> {
  const { url, keyPrefix } = getRedisConfig();

  if (!url) {
    return {
      status: "skipped",
      detail: "REDIS_URL is not set — rate limit & product cache use in-memory only",
    };
  }

  const target = redactRedisUrl(url);
  try {
    const client = await getRedis();
    if (!client) {
      return {
        status: "failed",
        detail:
          globalForRedis.__n8nappRedisLastError ||
          `unreachable ${target} — check URL, TLS (rediss://), password, firewall`,
      };
    }
    await client.ping();
    return {
      status: "connected",
      detail: `${target} (prefix=${keyPrefix})`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    globalForRedis.__n8nappRedisLastError = message;
    return {
      status: "failed",
      detail: `${target}: ${message}`,
    };
  }
}

/** Log once per chat request: status=connected|skipped|failed */
export async function logRedisStatusForRequest(route = "api/chat"): Promise<RedisStatusReport> {
  const report = await probeRedisStatus();
  console.log(`[redis] status=${report.status} route=${route} — ${report.detail}`);
  return report;
}

/** Prefixed Redis key helper. */
export function redisKey(...parts: string[]): string {
  const { keyPrefix } = getRedisConfig();
  return [keyPrefix, ...parts].join(":");
}

/** True when REDIS_URL is set (may still be reconnecting). */
export function isRedisConfigured(): boolean {
  return Boolean(getRedisConfig().url);
}
