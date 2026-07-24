/**
 * Normalize catalog ids to Shopify Admin GIDs (product or variant).
 */

/** Normalize a catalog product id to `gid://shopify/Product/{id}`. */
export function toShopifyProductGid(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const gidMatch = trimmed.match(/^gid:\/\/shopify\/Product\/(\d+)$/i);
  if (gidMatch) return `gid://shopify/Product/${gidMatch[1]}`;

  if (/^\d+$/.test(trimmed)) return `gid://shopify/Product/${trimmed}`;

  return null;
}

/** Normalize a variant id to `gid://shopify/ProductVariant/{id}`. */
export function toShopifyVariantGid(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const gidMatch = trimmed.match(/^gid:\/\/shopify\/ProductVariant\/(\d+)$/i);
  if (gidMatch) return `gid://shopify/ProductVariant/${gidMatch[1]}`;

  return null;
}

export type CatalogGidKind = "product" | "variant";

export interface ParsedCatalogGid {
  kind: CatalogGidKind;
  gid: string;
}

/** Parse a product or variant GID (or numeric product id). */
export function parseCatalogGid(raw: string): ParsedCatalogGid | null {
  const variant = toShopifyVariantGid(raw);
  if (variant) return { kind: "variant", gid: variant };

  const product = toShopifyProductGid(raw);
  if (product) return { kind: "product", gid: product };

  return null;
}
