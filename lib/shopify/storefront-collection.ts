/**
 * Resolve storefront category collections discovered via MCP search, then load
 * the full collection membership from the public products.json endpoint.
 *
 * Why: MCP free-text search over-counts (e.g. 23 "head guard" titles) while the
 * live Boxing → Head Guards page is a specific collection (17 products).
 * Admin GraphQL is intentionally not used for catalog; this uses the same
 * public storefront collection data the website shows.
 */

import { getShopifyConfig } from "@/lib/config";
import {
  expandCategoryCompoundsForMatch,
  extractProductTerms,
  matchTermsForQuery,
  titleHasTermForMatch,
} from "@/lib/shopify/compact-catalog";
import { logger } from "@/lib/logger";

export interface PickedCollection {
  handle: string;
  title: string;
  score: number;
  hitCount: number;
}

interface McpCollectionRef {
  title?: string;
  handle?: string;
}

interface McpProductRef {
  collections?: McpCollectionRef[];
}

/** Storefront origin used for /collections/{handle}/products.json */
export function storefrontCatalogOrigin(): string {
  const { storefrontUrl, domain } = getShopifyConfig();
  if (storefrontUrl) {
    try {
      return new URL(storefrontUrl).origin;
    } catch {
      // fall through
    }
  }
  return `https://${domain}`;
}

function collectionHaystack(title: string, handle: string): string {
  return expandCategoryCompoundsForMatch(
    `${title} ${handle.replace(/-/g, " ")}`,
  );
}

/**
 * Whether a collection title/handle matches the shopper category terms.
 * Treats "Headgear" collections as head+guard (store menu naming).
 */
export function collectionMatchesQueryTerms(
  title: string,
  handle: string,
  terms: string[],
): boolean {
  if (terms.length === 0) return false;
  const haystack = collectionHaystack(title, handle);

  if (terms.includes("head") && terms.includes("guard")) {
    const isHeadgearCategory =
      /\bhead[\s-]?gears?\b|\bheadgears?\b|\bhead[\s-]?guards?\b|\bheadguards?\b/i.test(
        haystack,
      );
    if (!isHeadgearCategory) return false;
    const rest = terms.filter((t) => t !== "head" && t !== "guard");
    return rest.every((t) => titleHasTermForMatch(haystack, t));
  }

  return terms.every((t) => titleHasTermForMatch(haystack, t));
}

function scoreCollection(
  title: string,
  handle: string,
  terms: string[],
  hitCount: number,
  query: string,
): number {
  if (!collectionMatchesQueryTerms(title, handle, terms)) return 0;

  let score = 100 + hitCount * 10;
  const haystack = collectionHaystack(title, handle);
  const q = query.toLowerCase();

  // Prefer primary nav categories over promo / seasonal collections.
  if (/\b(sale|deal|mothers?|bestseller|gift)\b/i.test(haystack)) {
    score -= 80;
  }

  if (/\bkids?\b/i.test(q)) {
    if (/\bkids?\b/i.test(haystack)) score += 40;
    else score -= 20;
  } else if (/\bmma\b/i.test(q)) {
    if (/\bmma\b/i.test(haystack)) score += 40;
    else score -= 10;
  } else if (/\bboxing\b/i.test(q) || (terms.includes("head") && terms.includes("guard"))) {
    // Default "head guards" / "boxing headgear" → Boxing menu collection.
    if (/\bboxing\b/i.test(haystack)) score += 40;
    if (/\bmma\b/i.test(haystack)) score -= 15;
  }

  // Prefer tighter, dedicated category handles.
  const handleParts = handle.split("-").filter(Boolean).length;
  score -= Math.max(0, handleParts - 4);

  return score;
}

/**
 * From an MCP search payload, pick the best matching storefront collection
 * (e.g. boxing-protective-gear-head-guards for "head guards").
 */
export function pickCategoryCollectionFromMcpSearch(
  rawMcpJson: string,
  query: string,
): PickedCollection | null {
  let parsed: { products?: McpProductRef[] };
  try {
    parsed = JSON.parse(rawMcpJson) as { products?: McpProductRef[] };
  } catch {
    return null;
  }

  const terms = matchTermsForQuery(query);
  if (terms.length < 2) return null;

  const tallies = new Map<
    string,
    { handle: string; title: string; hitCount: number }
  >();

  for (const product of parsed.products ?? []) {
    for (const col of product.collections ?? []) {
      const handle = String(col.handle ?? "").trim();
      const title = String(col.title ?? "").trim();
      if (!handle) continue;
      const prev = tallies.get(handle);
      if (prev) {
        prev.hitCount += 1;
      } else {
        tallies.set(handle, { handle, title: title || handle, hitCount: 1 });
      }
    }
  }

  let best: PickedCollection | null = null;
  for (const entry of tallies.values()) {
    const score = scoreCollection(
      entry.title,
      entry.handle,
      terms,
      entry.hitCount,
      query,
    );
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = {
        handle: entry.handle,
        title: entry.title,
        score,
        hitCount: entry.hitCount,
      };
    }
  }

  return best;
}

interface AjaxVariant {
  id?: number;
  title?: string;
  available?: boolean;
  price?: string;
  sku?: string;
}

interface AjaxProduct {
  id?: number;
  title?: string;
  handle?: string;
  url?: string;
  variants?: AjaxVariant[];
}

function priceToMinorUnits(price: string | undefined): number | null {
  if (!price) return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  // Ajax API returns major units ("106.99"); Admin sometimes uses cents.
  if (price.includes(".") || n < 1000) return Math.round(n * 100);
  return Math.round(n);
}

/**
 * Load every product in a storefront collection (public products.json).
 * Returns UCP-shaped JSON so compactCatalogMcpText can reuse the same path.
 */
export async function fetchStorefrontCollectionProducts(
  handle: string,
  options: {
    signal?: AbortSignal;
    availableOnly?: boolean;
    collectionTitle?: string;
  } = {},
): Promise<string> {
  const origin = storefrontCatalogOrigin();
  const availableOnly = options.availableOnly === true;
  const products: unknown[] = [];
  let page = 1;

  // products.json max page size is 250.
  for (;;) {
    const url = `${origin}/collections/${encodeURIComponent(handle)}/products.json?limit=250&page=${page}`;
    const res = await fetch(url, {
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(
        `Storefront collection fetch failed (${res.status}) for ${handle}`,
      );
    }
    const data = (await res.json()) as { products?: AjaxProduct[] };
    const batch = Array.isArray(data.products) ? data.products : [];
    if (batch.length === 0) break;

    for (const node of batch) {
      const idNum = node.id;
      const title = String(node.title ?? "").trim();
      if (!idNum || !title) continue;

      const currency = "GBP";
      const variants = (node.variants ?? []).map((v) => {
        const minor = priceToMinorUnits(v.price) ?? 0;
        return {
          id: v.id ? `gid://shopify/ProductVariant/${v.id}` : undefined,
          title: String(v.title ?? "Default"),
          sku: v.sku || undefined,
          availability: { available: Boolean(v.available) },
          price: { amount: minor, currency },
        };
      });

      const anyAvailable = variants.some((v) => v.availability.available);
      if (availableOnly && !anyAvailable) continue;

      const minMinor =
        variants.reduce<number | null>((min, v) => {
          const a = v.price.amount;
          if (min === null || a < min) return a;
          return min;
        }, null) ?? 0;

      const pathHandle = String(node.handle ?? "").trim();
      const url =
        typeof node.url === "string" && node.url.trim()
          ? node.url.startsWith("http")
            ? node.url
            : `${origin}${node.url}`
          : pathHandle
            ? `${origin}/products/${pathHandle}`
            : undefined;

      products.push({
        id: `gid://shopify/Product/${idNum}`,
        title,
        url,
        price_range: { min: { amount: minMinor, currency } },
        variants,
        collections: [
          {
            title: options.collectionTitle || handle,
            handle,
          },
        ],
      });
    }

    if (batch.length < 250) break;
    page += 1;
    if (page > 10) break;
  }

  logger.info("storefront-collection", "loaded collection products", {
    handle,
    count: products.length,
    availableOnly,
  });

  return JSON.stringify({
    products,
    pagination: { has_next_page: false },
    collection: {
      title: options.collectionTitle || handle,
      handle,
    },
  });
}

/** True when the query looks like a multi-word category browse/count. */
export function isCategoryStyleQuery(query: string): boolean {
  return extractProductTerms(query).length >= 2;
}
