/**
 * Shopify store credentials resolver.
 *
 * Today only the default store is configured (SHOPIFY_STORE_DOMAIN /
 * SHOPIFY_ADMIN_ACCESS_TOKEN). Region-specific env vars can be added later
 * without changing order-tracking business logic:
 *
 *   SHOPIFY_FR_STORE_DOMAIN / SHOPIFY_FR_ADMIN_ACCESS_TOKEN
 *   SHOPIFY_DE_STORE_DOMAIN / SHOPIFY_DE_ADMIN_ACCESS_TOKEN
 *   SHOPIFY_ES_STORE_DOMAIN / SHOPIFY_ES_ADMIN_ACCESS_TOKEN
 *   SHOPIFY_UK_STORE_DOMAIN / SHOPIFY_UK_ADMIN_ACCESS_TOKEN
 */

import { ConfigError, getShopifyConfig } from "@/lib/config";

export const SHOPIFY_API_VERSION = "2025-07";

/** Logical store regions for future multi-market support. */
export type ShopifyStoreRegion = "default" | "fr" | "de" | "es" | "uk";

/** The complete set of supported store regions. */
export const SHOPIFY_STORE_REGIONS: readonly ShopifyStoreRegion[] = [
  "default",
  "fr",
  "de",
  "es",
  "uk",
];

const VALID_REGIONS = new Set<ShopifyStoreRegion>(SHOPIFY_STORE_REGIONS);

/**
 * Parse an untrusted request value into a supported store region, falling back
 * to "default" for anything unknown. Shared by the API routes so region
 * validation lives in one place.
 */
export function parseShopifyRegion(raw: unknown): ShopifyStoreRegion {
  if (typeof raw !== "string") return "default";
  const region = raw.trim().toLowerCase() as ShopifyStoreRegion;
  return VALID_REGIONS.has(region) ? region : "default";
}

export interface ShopifyStoreCredentials {
  region: ShopifyStoreRegion;
  domain: string;
  accessToken: string;
  apiVersion: string;
}

const REGION_ENV: Record<
  Exclude<ShopifyStoreRegion, "default">,
  { domain: string; token: string }
> = {
  fr: {
    domain: "SHOPIFY_FR_STORE_DOMAIN",
    token: "SHOPIFY_FR_ADMIN_ACCESS_TOKEN",
  },
  de: {
    domain: "SHOPIFY_DE_STORE_DOMAIN",
    token: "SHOPIFY_DE_ADMIN_ACCESS_TOKEN",
  },
  es: {
    domain: "SHOPIFY_ES_STORE_DOMAIN",
    token: "SHOPIFY_ES_ADMIN_ACCESS_TOKEN",
  },
  uk: {
    domain: "SHOPIFY_UK_STORE_DOMAIN",
    token: "SHOPIFY_UK_ADMIN_ACCESS_TOKEN",
  },
};

/**
 * Resolve credentials for a store region.
 * Falls back to the default store when a regional pair is not configured.
 */
export function resolveShopifyStore(
  region: ShopifyStoreRegion = "default"
): ShopifyStoreCredentials {
  if (region === "default") {
    const { domain, accessToken } = getShopifyConfig();
    return {
      region,
      domain,
      accessToken,
      apiVersion: SHOPIFY_API_VERSION,
    };
  }

  const keys = REGION_ENV[region];
  const domain = process.env[keys.domain]?.trim();
  const accessToken = process.env[keys.token]?.trim();

  if (domain && accessToken) {
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain)) {
      throw new ConfigError(
        `${keys.domain} must be a *.myshopify.com domain without protocol (got "${domain}").`
      );
    }
    return {
      region,
      domain,
      accessToken,
      apiVersion: SHOPIFY_API_VERSION,
    };
  }

  // Soft fallback in development only — production must configure the region.
  if (process.env.NODE_ENV === "production") {
    throw new ConfigError(
      `Shopify region "${region}" is not configured. Set ${keys.domain} and ${keys.token}.`
    );
  }

  const fallback = getShopifyConfig();
  return {
    region: "default",
    domain: fallback.domain,
    accessToken: fallback.accessToken,
    apiVersion: SHOPIFY_API_VERSION,
  };
}
