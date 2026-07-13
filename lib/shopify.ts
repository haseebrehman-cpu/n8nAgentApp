/**
 * Shopify Admin GraphQL API client.
 *
 * Required env vars (set in .env.local):
 *   SHOPIFY_STORE_DOMAIN        e.g. "your-store.myshopify.com"
 *   SHOPIFY_ADMIN_ACCESS_TOKEN  Admin API access token with read_products scope
 */

const API_VERSION = "2025-07";

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
  onlineStoreUrl: string | null;
  priceRange: {
    min: string;
    max: string;
    currency: string;
  };
  totalInventory: number | null;
  imageUrl: string | null;
  variants: ProductVariant[];
}

class ShopifyConfigError extends Error {}

function getConfig() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!domain || !token) {
    throw new ShopifyConfigError(
      "Shopify credentials are not configured. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN in .env.local."
    );
  }
  return { domain, token };
}

async function shopifyGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const { domain, token } = getConfig();
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json.data as T;
}

const PRODUCT_SEARCH_QUERY = /* GraphQL */ `
  query SearchProducts($query: String!, $first: Int!) {
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
          onlineStoreUrl
          totalInventory
          featuredImage {
            url
          }
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
            maxVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 25) {
            edges {
              node {
                id
                title
                price
                availableForSale
                inventoryQuantity
              }
            }
          }
        }
      }
    }
  }
`;

interface RawProductNode {
  id: string;
  title: string;
  status: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  onlineStoreUrl: string | null;
  totalInventory: number | null;
  featuredImage: { url: string } | null;
  priceRangeV2: {
    minVariantPrice: { amount: string; currencyCode: string };
    maxVariantPrice: { amount: string; currencyCode: string };
  };
  variants: { edges: { node: ProductVariant }[] };
}

interface SearchProductsData {
  products: { edges: { node: RawProductNode }[] };
}

function toProductSummary(node: RawProductNode): ProductSummary {
  // Omit image URLs so the model cannot dump raw CDN markdown into chat replies.
  const description = node.description
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

  return {
    id: node.id,
    title: node.title,
    status: node.status,
    description,
    productType: node.productType,
    vendor: node.vendor,
    tags: node.tags,
    onlineStoreUrl: null,
    priceRange: {
      min: node.priceRangeV2.minVariantPrice.amount,
      max: node.priceRangeV2.maxVariantPrice.amount,
      currency: node.priceRangeV2.minVariantPrice.currencyCode,
    },
    totalInventory: node.totalInventory,
    imageUrl: null,
    variants: node.variants.edges.map((e) => ({
      id: e.node.id,
      title: e.node.title,
      price: e.node.price,
      availableForSale: e.node.availableForSale,
      inventoryQuantity: e.node.inventoryQuantity,
    })),
  };
}

/** Search store products by keyword (matches title, type, vendor, and tags). */
export async function searchProducts(keyword: string, limit = 10): Promise<ProductSummary[]> {
  const sanitized = keyword.replace(/["\\]/g, " ").trim();
  const data = await shopifyGraphql<SearchProductsData>(PRODUCT_SEARCH_QUERY, {
    query: sanitized,
    first: Math.min(Math.max(limit, 1), 25),
  });
  return data.products.edges.map((e) => toProductSummary(e.node));
}

export function isShopifyConfigError(err: unknown): boolean {
  return err instanceof ShopifyConfigError;
}
