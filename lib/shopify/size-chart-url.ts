/**
 * Strict allowlist for product size-chart image URLs.
 * Separate from chat link allowlisting — CDN hosts are blocked for general
 * assistant markdown links, but verified size-chart attachments may use them.
 */

import { getStorefrontHost } from "@/lib/url-allowlist";

const IMAGE_PATH_EXT = /\.(webp|png|jpe?g|gif)$/i;

/** True when the URL is a safe HTTPS size-chart image on an allowed host/path. */
export function isAllowedSizeChartUrl(href: string | undefined): boolean {
  if (!href || typeof href !== "string") return false;
  try {
    const url = new URL(href.trim());
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;

    const host = url.hostname.toLowerCase();
    const path = url.pathname;
    if (!IMAGE_PATH_EXT.test(path)) return false;

    // Storefront-hosted CDN files: https://rdxsports.co.uk/cdn/shop/files/...
    if (path.startsWith("/cdn/shop/files/")) {
      const storefront = getStorefrontHost();
      if (storefront && (host === storefront || host.endsWith(`.${storefront}`))) {
        return true;
      }
      if (host.endsWith(".myshopify.com")) return true;
      return false;
    }

    // Shopify global CDN: https://cdn.shopify.com/s/files/...
    if (
      (host === "cdn.shopify.com" || host.endsWith(".cdn.shopify.com")) &&
      (path.startsWith("/s/files/") || path.startsWith("/shop/files/"))
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export { toShopifyProductGid } from "@/lib/shopify/gid";
