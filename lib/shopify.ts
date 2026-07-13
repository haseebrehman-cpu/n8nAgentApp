/**
 * Shopify Admin GraphQL API client.
 *
 * Prices are resolved per market when SHOPIFY_MARKET_COUNTRY is set,
 * so the assistant quotes exactly what customers see on the storefront.
 */

import { getShopifyConfig } from "@/lib/config";

const API_VERSION = "2025-07";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 25;

interface ProductVariant {
  id: string;
  title: string;
  price: string;
  availableForSale: boolean;
  inventoryQuantity: number | null;
}

export interface ProductSummary {
  id: string;
  title: string;
  status: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  priceRange: {
    min: string;
    max: string;
    currency: string;
  };
  totalInventory: number | null;
  variants: ProductVariant[];
}

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
    ? `contextualPricing(context: { country: $country }) { price { amount currencyCode } }`
    : `price`;

  const vars = withMarketPricing
    ? `$query: String!, $first: Int!, $country: CountryCode!`
    : `$query: String!, $first: Int!`;

  return `
  query SearchProducts(${vars}) {
    products(first: $first, query: $query) {
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
  contextualPricing?: { price: Money | null } | null;
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
  products: { edges: { node: RawProductNode }[] };
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
    totalInventory: node.totalInventory,
    variants: node.variants.edges.map(({ node: v }) => ({
      id: v.id,
      title: v.title,
      price: v.contextualPricing?.price?.amount ?? v.price ?? "unknown",
      availableForSale: v.availableForSale,
      inventoryQuantity: v.inventoryQuantity,
    })),
  };
}

/** Search store products by keyword (matches title, type, vendor, and tags). */
export async function searchProducts(
  keyword: string,
  limit = 10
): Promise<ProductSummary[]> {
  const { marketCountry } = getShopifyConfig();
  const sanitized = keyword.replace(/["\\]/g, " ").trim();

  const variables: Record<string, unknown> = {
    query: sanitized,
    first: Math.min(Math.max(limit, 1), MAX_RESULTS),
  };
  if (marketCountry) variables.country = marketCountry;

  const data = await shopifyGraphql<SearchProductsData>(
    buildSearchQuery(Boolean(marketCountry)),
    variables
  );
  return data.products.edges.map((e) => toProductSummary(e.node));
}
