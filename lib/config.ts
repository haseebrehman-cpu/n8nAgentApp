/**
 * Centralized, validated server configuration.
 * Fails fast with a clear message when an env var is missing or malformed.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface OpenAIConfig {
  apiKey: string;
  model: string;
}

export interface ShopifyConfig {
  domain: string;
  accessToken: string;
  /** ISO 3166-1 alpha-2 country code for market-specific pricing (e.g. "DE"). */
  marketCountry: string | null;
  /**
   * Public storefront origin used to build product page URLs
   * (e.g. "https://www.example.com"). Null when unset — falls back to
   * Shopify's onlineStoreUrl when available.
   */
  storefrontUrl: string | null;
}

export interface RedisConfig {
  /** Connection URL (`redis://` or `rediss://`). Null when unset (dev fallback). */
  url: string | null;
  /** Logical key namespace shared across all Redis keys. */
  keyPrefix: string;
  /**
   * TTL for product-by-id payloads and non-empty search→id indexes (seconds).
   * Default 30 minutes — balance Shopify load vs price/stock freshness.
   */
  productCacheTtlSeconds: number;
  /** Empty-result (negative) cache TTL — shorter so new products appear sooner. */
  productCacheEmptyTtlSeconds: number;
}

export function getOpenAIConfig(): OpenAIConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError("OPENAI_API_KEY is not set. Add it to .env.local.");
  }
  return {
    apiKey,
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
  };
}

export function getShopifyConfig(): ShopifyConfig {
  const domain = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();

  if (!domain || !accessToken) {
    throw new ConfigError(
      "Shopify credentials are not configured. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN in .env.local."
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain)) {
    throw new ConfigError(
      `SHOPIFY_STORE_DOMAIN must be a *.myshopify.com domain without protocol (got "${domain}").`
    );
  }

  const rawCountry = process.env.SHOPIFY_MARKET_COUNTRY?.trim().toUpperCase() || null;
  if (rawCountry && !/^[A-Z]{2}$/.test(rawCountry)) {
    throw new ConfigError(
      `SHOPIFY_MARKET_COUNTRY must be a 2-letter ISO country code (got "${rawCountry}").`
    );
  }
  // Shopify CountryCode uses GB, not UK.
  const marketCountry =
    rawCountry === "UK" ? "GB" : rawCountry;

  const storefrontUrl = parseStorefrontUrl(process.env.SHOPIFY_STOREFRONT_URL);

  return { domain, accessToken, marketCountry, storefrontUrl };
}

/** Validate and normalize a public storefront origin (no trailing slash). */
function parseStorefrontUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  // Allow bare hostnames (common mistake) by assuming https.
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new ConfigError(
      `SHOPIFY_STOREFRONT_URL must be a valid absolute URL (got "${value}"). Example: https://www.example.com`
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ConfigError(
      `SHOPIFY_STOREFRONT_URL must use http or https (got "${value}").`
    );
  }

  if (!parsed.hostname) {
    throw new ConfigError(
      `SHOPIFY_STOREFRONT_URL is missing a hostname (got "${value}").`
    );
  }

  // Origin only — path/query/hash are ignored so /products/{handle} is predictable.
  return parsed.origin;
}

let warnedMissingRedis = false;

export function getRedisConfig(): RedisConfig {
  const url = process.env.REDIS_URL?.trim() || null;
  if (url && !/^rediss?:\/\//i.test(url)) {
    throw new ConfigError(
      `REDIS_URL must start with redis:// or rediss:// (got a value that does not).`
    );
  }

  if (!url && process.env.NODE_ENV === "production" && !warnedMissingRedis) {
    warnedMissingRedis = true;
    console.warn(
      "[redis] REDIS_URL is not set. Rate limiting and product cache use in-memory fallbacks (not safe across multiple instances)."
    );
  }

  const keyPrefix = process.env.REDIS_KEY_PREFIX?.trim() || "n8napp";

  const productCacheTtlSeconds = parsePositiveInt(
    process.env.PRODUCT_CACHE_TTL_SECONDS,
    1800
  );
  const productCacheEmptyTtlSeconds = parsePositiveInt(
    process.env.PRODUCT_CACHE_EMPTY_TTL_SECONDS,
    20
  );

  return {
    url,
    keyPrefix,
    productCacheTtlSeconds,
    productCacheEmptyTtlSeconds,
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new ConfigError(
      `Expected a positive integer (got "${raw}").`
    );
  }
  return n;
}

export function isConfigError(err: unknown): err is ConfigError {
  return err instanceof ConfigError;
}
