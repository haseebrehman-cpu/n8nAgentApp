/**
 * Link allowlist for assistant markdown.
 * Blocks dangerous schemes and Shopify CDN; allows storefront + common carriers.
 */

const CARRIER_HOST_HINTS = [
  "tracking",
  "dhl.",
  "ups.",
  "fedex.",
  "dpd.",
  "gls.",
  "post.",
  "parcelsapp.",
  "aftership.",
  "17track.",
  "royalmail.",
  "hermes.",
  "evri.",
];

export function getStorefrontHost(): string | null {
  const host = process.env.NEXT_PUBLIC_STOREFRONT_HOST?.trim().toLowerCase();
  if (!host) return null;
  return host.replace(/^https?:\/\//, "").split("/")[0] || null;
}

export function isAllowedChatHref(href: string | undefined): boolean {
  if (!href || !/^https?:\/\//i.test(href)) return false;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host.includes("cdn.shopify.com")) return false;

    const storefront = getStorefrontHost();
    if (storefront && (host === storefront || host.endsWith(`.${storefront}`))) {
      return true;
    }
    if (host.endsWith(".myshopify.com")) return true;
    if (CARRIER_HOST_HINTS.some((h) => host.includes(h))) return true;

    // Without a configured storefront host, allow https product/carrier links
    // (server already strips CDN/images). Prefer setting NEXT_PUBLIC_STOREFRONT_HOST.
    return !storefront;
  } catch {
    return false;
  }
}
