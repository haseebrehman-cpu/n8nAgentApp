/**
 * Resolve Shopify catalog collections for category-style queries
 * (e.g. "competition gloves" → Collection "Competition Gloves" with 10 products).
 *
 * Free-text MCP search + title filtering under-counts because many collection
 * members omit the category words in the product title (e.g. "Fight Gloves").
 */

import { shopifyAdminGraphql } from "@/lib/shopify/admin-client";
import {
  extractProductTerms,
} from "@/lib/shopify/compact-catalog";
import type { ShopifyStoreRegion } from "@/services/shopify/credentials";
import { resolveShopifyStore } from "@/services/shopify/credentials";

export interface ResolvedCollection {
  id: string;
  handle: string;
  title: string;
  productsCount: number;
  score: number;
}

interface AdminMoney {
  amount?: string;
  currencyCode?: string;
}

interface AdminVariantNode {
  id: string;
  title: string;
  sku?: string | null;
  availableForSale: boolean;
  price: string;
}

interface AdminProductNode {
  id: string;
  title: string;
  status: string;
  onlineStoreUrl?: string | null;
  priceRangeV2?: { minVariantPrice?: AdminMoney };
  compareAtPriceRange?: { minVariantCompareAtPrice?: AdminMoney };
  variants?: { edges: { node: AdminVariantNode }[] };
}

function textHasTerm(text: string, term: string): boolean {
  const kindRe = new RegExp(
    `(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s)?([^a-z0-9]|$)`,
    "i"
  );
  return kindRe.test(text);
}

/** Score how well a collection title/handle matches the shopper query terms. */
export function scoreCollectionMatch(
  title: string,
  handle: string,
  terms: string[]
): number {
  if (terms.length === 0) return 0;
  const haystack = `${title} ${handle.replace(/-/g, " ")}`;
  const matched = terms.filter((t) => textHasTerm(haystack, t));
  if (matched.length < terms.length) {
    // Partial match — not good enough for category totals
    return matched.length;
  }
  // Full match: prefer tighter titles (exact category name over broader ones)
  const titleTerms = extractProductTerms(title);
  return 100 + terms.length * 10 - titleTerms.length;
}

/**
 * Find the best Shopify collection for a multi-word category query.
 * Returns null when no collection title/handle contains every query term.
 */
export async function resolveCollectionForQuery(
  query: string,
  options: { signal?: AbortSignal; region?: ShopifyStoreRegion } = {}
): Promise<ResolvedCollection | null> {
  const terms = extractProductTerms(query);
  // Single vague words ("boxing", "gloves") are discovery — not category totals
  if (terms.length < 2) return null;

  const credentials = resolveShopifyStore(options.region ?? "default");
  const searchQ = terms.join(" ");

  const data = await shopifyAdminGraphql<{
    collections: {
      edges: {
        node: {
          id: string;
          handle: string;
          title: string;
          productsCount: { count: number };
        };
      }[];
    };
  }>(
    `query Collections($q: String!) {
      collections(first: 25, query: $q) {
        edges {
          node {
            id
            handle
            title
            productsCount { count }
          }
        }
      }
    }`,
    { q: searchQ },
    { credentials, signal: options.signal }
  );

  let best: ResolvedCollection | null = null;
  for (const edge of data.collections?.edges ?? []) {
    const node = edge.node;
    const score = scoreCollectionMatch(node.title, node.handle, terms);
    if (score < 100) continue; // require full term match
    if (!best || score > best.score) {
      best = {
        id: node.id,
        handle: node.handle,
        title: node.title,
        productsCount: node.productsCount?.count ?? 0,
        score,
      };
    }
  }

  return best;
}

function toMinorUnits(amount: string | undefined): number | null {
  if (!amount) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Load products from a collection as UCP-shaped JSON so compactCatalogMcpText
 * can reuse the same compaction path.
 */
export async function fetchCollectionProductsRaw(
  handle: string,
  options: {
    signal?: AbortSignal;
    region?: ShopifyStoreRegion;
    availableOnly?: boolean;
    collectionTitle?: string;
  } = {}
): Promise<string> {
  const credentials = resolveShopifyStore(options.region ?? "default");
  const availableOnly = options.availableOnly !== false;

  const data = await shopifyAdminGraphql<{
    collectionByHandle: {
      title: string;
      handle: string;
      products: { edges: { node: AdminProductNode }[]; pageInfo: { hasNextPage: boolean } };
    } | null;
  }>(
    `query CollectionProducts($handle: String!) {
      collectionByHandle(handle: $handle) {
        title
        handle
        products(first: 50) {
          pageInfo { hasNextPage }
          edges {
            node {
              id
              title
              status
              onlineStoreUrl
              priceRangeV2 {
                minVariantPrice { amount currencyCode }
              }
              compareAtPriceRange {
                minVariantCompareAtPrice { amount currencyCode }
              }
              variants(first: 40) {
                edges {
                  node {
                    id
                    title
                    sku
                    availableForSale
                    price
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { handle },
    { credentials, signal: options.signal }
  );

  const collection = data.collectionByHandle;
  if (!collection) {
    return JSON.stringify({ products: [], pagination: { has_next_page: false } });
  }

  const collectionMeta = {
    title: collection.title,
    handle: collection.handle,
  };

  const products = [];
  for (const edge of collection.products.edges) {
    const node = edge.node;
    if (node.status && node.status !== "ACTIVE") continue;

    const currency =
      node.priceRangeV2?.minVariantPrice?.currencyCode?.toUpperCase() || "GBP";
    const minMinor = toMinorUnits(node.priceRangeV2?.minVariantPrice?.amount);
    const compareMinor = toMinorUnits(
      node.compareAtPriceRange?.minVariantCompareAtPrice?.amount
    );

    const variants = (node.variants?.edges ?? []).map(({ node: v }) => {
      const priceMinor = toMinorUnits(v.price) ?? minMinor ?? 0;
      return {
        id: v.id,
        title: v.title,
        sku: v.sku ?? undefined,
        availability: { available: Boolean(v.availableForSale) },
        price: { amount: priceMinor, currency },
      };
    });

    const anyAvailable = variants.some((v) => v.availability.available);
    if (availableOnly && !anyAvailable) continue;

    products.push({
      id: node.id,
      title: node.title,
      url: node.onlineStoreUrl ?? undefined,
      price_range:
        minMinor !== null
          ? { min: { amount: minMinor, currency } }
          : undefined,
      list_price_range:
        compareMinor !== null && compareMinor > 0
          ? { min: { amount: compareMinor, currency } }
          : undefined,
      variants,
      collections: [collectionMeta],
    });
  }

  return JSON.stringify({
    products,
    pagination: {
      has_next_page: Boolean(collection.products.pageInfo?.hasNextPage),
    },
    collection: {
      title: collection.title,
      handle: collection.handle,
    },
  });
}

/** True when the query looks like a storefront category (2+ meaningful terms). */
export function isCategoryStyleQuery(query: string): boolean {
  return extractProductTerms(query).length >= 2;
}
