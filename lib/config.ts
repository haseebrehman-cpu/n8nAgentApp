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

  return { domain, accessToken, marketCountry: rawCountry };
}

export function isConfigError(err: unknown): err is ConfigError {
  return err instanceof ConfigError;
}
