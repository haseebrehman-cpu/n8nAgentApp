/**
 * Shopify Admin GraphQL API client.
 *
 * Prices are resolved per market when SHOPIFY_MARKET_COUNTRY is set,
 * so the assistant quotes exactly what customers see on the storefront.
 *
 * All catalog lookups are scoped to ACTIVE products published on the
 * Online Store channel — drafts, archives, and Admin-only duplicates
 * (e.g. "… (Copy)") never reach the assistant.
 */

import { getShopifyConfig } from "@/lib/config";
import { cachedProductSearch } from "@/lib/product-cache";
import type { ProductSummary } from "@/lib/types";

export type { ProductSummary };

const API_VERSION = "2025-07";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 25;
/** Page size when scanning the catalog for discounts. */
const DISCOUNT_PAGE_SIZE = 50;
/** Soft cap so a huge catalog cannot loop forever. */
const DISCOUNT_MAX_PAGES = 10;
const DISCOUNT_RESULT_LIMIT = 25;

/**
 * Admin product search scope matching what customers can see.
 */
const STOREFRONT_SCOPE = "status:ACTIVE";

async function shopifyGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const { domain, accessToken } = getShopifyConfig();

  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(
      `Shopify GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`
    );
  }
  return json.data as T;
}

/**
 * Two query variants: with market-contextual pricing (when a market country
 * is configured) and without (base shop prices).
 * Supports cursor pagination via $after.
 */
function buildSearchQuery(withMarketPricing: boolean): string {
  const productPricing = withMarketPricing
    ? `contextualPricing(context: { country: $country }) {
        minVariantPricing { price { amount currencyCode } }
        maxVariantPricing { price { amount currencyCode } }
      }`
    : `priceRangeV2 {
        minVariantPrice { amount currencyCode }
        maxVariantPrice { amount currencyCode }
      }`;

  const variantPricing = withMarketPricing
    ? `contextualPricing(context: { country: $country }) {
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
      }`
    : `price
       compareAtPrice`;

  const vars = withMarketPricing
    ? `$query: String!, $first: Int!, $after: String, $country: CountryCode!`
    : `$query: String!, $first: Int!, $after: String`;

  return `
  query SearchProducts(${vars}) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          status
          description(truncateAt: 600)
          productType
          vendor
          tags
          totalInventory
          ${productPricing}
          variants(first: ${MAX_RESULTS}) {
            edges {
              node {
                id
                title
                availableForSale
                inventoryQuantity
                ${variantPricing}
              }
            }
          }
        }
      }
    }
  }`;
}

interface Money {
  amount: string;
  currencyCode: string;
}

interface RawVariantNode {
  id: string;
  title: string;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  price?: string;
  compareAtPrice?: string | null;
  contextualPricing?: {
    price: Money | null;
    compareAtPrice: Money | null;
  } | null;
}

interface RawProductNode {
  id: string;
  title: string;
  status: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  totalInventory: number | null;
  priceRangeV2?: { minVariantPrice: Money; maxVariantPrice: Money };
  contextualPricing?: {
    minVariantPricing: { price: Money } | null;
    maxVariantPricing: { price: Money } | null;
  } | null;
  variants: { edges: { node: RawVariantNode }[] };
}

interface SearchProductsData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { node: RawProductNode }[];
  };
}

function toProductSummary(node: RawProductNode): ProductSummary {
  const min =
    node.contextualPricing?.minVariantPricing?.price ??
    node.priceRangeV2?.minVariantPrice;
  const max =
    node.contextualPricing?.maxVariantPricing?.price ??
    node.priceRangeV2?.maxVariantPrice;

  // Strip images/URLs and hard-cap description length; the model summarizes it.
  const description = node.description.replace(/\s+/g, " ").trim().slice(0, 400);

  const variants = node.variants.edges.map(({ node: v }) => {
    const price = v.contextualPricing?.price?.amount ?? v.price ?? "unknown";
    const compareAtPrice =
      v.contextualPricing?.compareAtPrice?.amount ?? v.compareAtPrice ?? null;
    return {
      id: v.id,
      title: v.title,
      price,
      compareAtPrice: isRealDiscount(price, compareAtPrice) ? compareAtPrice : null,
      availableForSale: v.availableForSale,
      inventoryQuantity: v.inventoryQuantity,
    };
  });

  return {
    id: node.id,
    title: node.title,
    status: node.status,
    description,
    productType: node.productType,
    vendor: node.vendor,
    tags: node.tags,
    priceRange: {
      min: min?.amount ?? "unknown",
      max: max?.amount ?? "unknown",
      currency: min?.currencyCode ?? "",
    },
    onSale: variants.some((v) => v.compareAtPrice !== null),
    totalInventory: node.totalInventory,
    variants,
  };
}

/** A genuine discount requires a compare-at price strictly greater than the price. */
function isRealDiscount(price: string, compareAtPrice: string | null): boolean {
  if (!compareAtPrice) return false;
  const p = Number.parseFloat(price);
  const c = Number.parseFloat(compareAtPrice);
  if (!Number.isFinite(p) || !Number.isFinite(c)) return false;
  return c > p;
}

/** Combine a free-text keyword with the Online Store visibility scope. */
function storefrontQuery(keyword?: string): string {
  const k = keyword?.trim();
  if (!k) return STOREFRONT_SCOPE;
  return `${STOREFRONT_SCOPE} AND ${k}`;
}

/** Drop Admin-only noise that sometimes slips through (duplicate titles). */
function isStorefrontWorthy(product: ProductSummary): boolean {
  if (product.status && product.status.toUpperCase() !== "ACTIVE") return false;
  // Shopify duplicates append "(Copy)" — never treat as a customer-facing listing
  if (/\(copy\)/i.test(product.title)) return false;
  return true;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "with",
  "and",
  "or",
  "for",
  "of",
  "in",
  "to",
  "set",
  "ft",
  "what",
  "is",
  "price",
  "this",
  "that",
  "please",
  "me",
]);

/** Build a few search variants so long product titles still hit the catalog. */
function buildSearchQueries(keyword: string): string[] {
  const sanitized = keyword.replace(/["\\]/g, " ").trim();
  if (!sanitized) return [];

  const tokens = sanitized
    .split(/\s+/)
    .map((t) => t.replace(/[^a-zA-Z0-9-]/g, ""))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t.toLowerCase()));

  const queries: string[] = [sanitized];

  if (tokens.length >= 2) {
    // Distinctive middle terms often match better than the full marketing title
    queries.push(tokens.slice(0, 4).join(" "));
    if (tokens.length > 4) {
      queries.push(tokens.slice(-3).join(" "));
    }
  } else if (tokens.length === 1) {
    queries.push(tokens[0]);
  }

  // Deduplicate while preserving order, then wrap each in storefront scope
  return [...new Set(queries.filter(Boolean))].map((q) => storefrontQuery(q));
}

async function runProductQuery(
  query: string,
  first: number,
  marketCountry: string | null,
  after: string | null = null
): Promise<{
  products: ProductSummary[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const variables: Record<string, unknown> = { query, first, after };
  if (marketCountry) variables.country = marketCountry;

  const data = await shopifyGraphql<SearchProductsData>(
    buildSearchQuery(Boolean(marketCountry)),
    variables
  );

  const products = data.products.edges
    .map((e) => toProductSummary(e.node))
    .filter(isStorefrontWorthy);

  return {
    products,
    hasNextPage: data.products.pageInfo.hasNextPage,
    endCursor: data.products.pageInfo.endCursor,
  };
}

async function searchProductsUncached(
  keyword: string,
  limit: number,
  marketCountry: string | null
): Promise<ProductSummary[]> {
  const first = Math.min(Math.max(limit, 1), MAX_RESULTS);
  const queries = buildSearchQueries(keyword);

  for (const query of queries) {
    const { products } = await runProductQuery(query, first, marketCountry);
    if (products.length > 0) return products;
  }

  return [];
}

/**
 * Search store products by keyword (title, type, vendor, tags).
 * Results use two-layer Redis cache (search→IDs + product-by-id) with coalescing.
 * Only ACTIVE + Online Store published products are returned.
 */
export async function searchProducts(
  keyword: string,
  limit = 10
): Promise<ProductSummary[]> {
  const { marketCountry } = getShopifyConfig();
  const results = await cachedProductSearch(keyword, limit, marketCountry, () =>
    searchProductsUncached(keyword, limit, marketCountry)
  );
  // Drop stale cache entries that are not storefront-visible / are Admin copies
  return results.filter(isStorefrontWorthy);
}

/**
 * Return storefront-visible products that are genuinely on sale
 * (compare-at price exceeds current price). Paginates the published
 * catalog so sale items beyond the first page are not missed.
 */
export async function getDiscountedProducts(
  limit = DISCOUNT_RESULT_LIMIT
): Promise<ProductSummary[]> {
  const { marketCountry } = getShopifyConfig();
  const capped = Math.min(Math.max(limit, 1), DISCOUNT_RESULT_LIMIT);
  const onSale: ProductSummary[] = [];
  let after: string | null = null;

  for (let page = 0; page < DISCOUNT_MAX_PAGES; page++) {
    const { products, hasNextPage, endCursor } = await runProductQuery(
      storefrontQuery(),
      DISCOUNT_PAGE_SIZE,
      marketCountry,
      after
    );

    for (const p of products) {
      if (p.onSale) onSale.push(p);
      if (onSale.length >= capped) return onSale.slice(0, capped);
    }

    if (!hasNextPage || !endCursor) break;
    after = endCursor;
  }

  return onSale;
}
