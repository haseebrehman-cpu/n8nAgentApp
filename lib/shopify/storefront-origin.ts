/**
 * Public storefront origin used for the unauthenticated JSON endpoints
 * (/collections.json, /collections/{handle}/products.json, /search/suggest.json).
 *
 * Lives in its own module so the collection directory and the collection
 * loader can share it without importing each other.
 */

import { getShopifyConfig } from "@/lib/config";

export function storefrontCatalogOrigin(): string {
  const { storefrontUrl, domain } = getShopifyConfig();
  if (storefrontUrl) {
    try {
      return new URL(storefrontUrl).origin;
    } catch {
      // fall through to the admin domain
    }
  }
  return `https://${domain}`;
}
