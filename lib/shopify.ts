/**
 * Shopify Admin GraphQL API client.
 *
 * Prices are resolved per market when SHOPIFY_MARKET_COUNTRY is set.
 * Catalog lookups are scoped to ACTIVE + published Online Store products.
 */

import { getShopifyConfig } from "@/lib/config";
import {
  cachedDiscountedProducts,
  cachedProductSearch,
} from "@/lib/product-cache";
import { shopifyAdminGraphql } from "@/lib/shopify/admin-client";
import type { ProductSummary } from "@/lib/types";

export type { ProductSummary };

const MAX_RESULTS = 25;
const DISCOUNT_PAGE_SIZE = 50;
const DISCOUNT_MAX_PAGES = 10;
const DISCOUNT_RESULT_LIMIT = 8;

/** ACTIVE + published on Online Store channel. */
const STOREFRONT_SCOPE = "status:ACTIVE published_status:published";

export interface ShopifyFetchOptions {
  signal?: AbortSignal;
  /** When listing a category, only include in-stock / available products. */
  inStockOnly?: boolean;
  /** Cap for category list samples (defaults to CATEGORY_LIST_LIMIT, max MAX_RESULTS). */
  limit?: number;
}

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

  // Always fetch base price/compareAtPrice. Market compare-at can be null even
  // when the variant has a real sale (e.g. FR market vs UK storefront).
  const variantPricing = withMarketPricing
    ? `price
       compareAtPrice
       contextualPricing(context: { country: $country }) {
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
          handle
          onlineStoreUrl
          status
          description(truncateAt: 200)
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
  handle: string;
  onlineStoreUrl: string | null;
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

function resolveProductUrl(
  handle: string,
  onlineStoreUrl: string | null
): string | null {
  const { storefrontUrl } = getShopifyConfig();
  const slug = handle?.trim();
  if (storefrontUrl && slug) {
    return `${storefrontUrl}/products/${slug}`;
  }
  if (onlineStoreUrl && /^https?:\/\//i.test(onlineStoreUrl)) {
    return onlineStoreUrl;
  }
  return null;
}

function withFreshProductUrls(products: ProductSummary[]): ProductSummary[] {
  return products.map((p) => ({
    ...p,
    url: resolveProductUrl(p.handle ?? "", p.url),
  }));
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

  const description = node.description.replace(/\s+/g, " ").trim().slice(0, 200);

  const variants = node.variants.edges.map(({ node: v }) => {
    const price = v.contextualPricing?.price?.amount ?? v.price ?? "unknown";
    // Prefer market compare-at when present; otherwise keep the base sale price
    // so discounts still show for the UK storefront.
    const compareAtPrice =
      v.contextualPricing?.compareAtPrice?.amount ??
      v.compareAtPrice ??
      null;
    return {
      id: v.id,
      title: v.title,
      price,
      compareAtPrice: isRealDiscount(price, compareAtPrice) ? compareAtPrice : null,
      availableForSale: v.availableForSale,
      inventoryQuantity: v.inventoryQuantity,
    };
  });

  const handle = node.handle?.trim() ?? "";

  return {
    id: node.id,
    title: node.title,
    handle,
    url: resolveProductUrl(handle, node.onlineStoreUrl),
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

function isRealDiscount(price: string, compareAtPrice: string | null): boolean {
  if (!compareAtPrice) return false;
  const p = Number.parseFloat(price);
  const c = Number.parseFloat(compareAtPrice);
  if (!Number.isFinite(p) || !Number.isFinite(c)) return false;
  return c > p;
}

function storefrontQuery(keyword?: string): string {
  const k = keyword?.trim();
  if (!k) return STOREFRONT_SCOPE;
  return `${STOREFRONT_SCOPE} AND ${k}`;
}

function isStorefrontWorthy(product: ProductSummary): boolean {
  if (product.status && product.status.toUpperCase() !== "ACTIVE") return false;
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

/** Expand ambiguous short keywords into related catalog terms. */
const SEARCH_SYNONYMS: Record<string, string[]> = {
  gloves: ["boxing gloves", "mma gloves", "bag gloves"],
  glove: ["boxing gloves", "mma gloves"],
  shorts: ["boxing shorts", "mma shorts", "compression shorts", "sweat shorts"],
  wraps: ["hand wraps", "boxing wraps"],
  wrap: ["hand wraps"],
  headguard: ["head guard", "boxing head guard"],
  headguards: ["head guard", "boxing head guard"],
  "punching bag": ["punch bag", "heavy bag"],
  "punch bag": ["punching bag", "heavy bag"],
  shoes: ["boxing shoes", "boxing boots"],
  boots: ["boxing boots", "boxing shoes"],
  equipment: ["boxing equipment", "training equipment"],
  apparel: ["boxing apparel", "mma apparel"],
  protein: ["protein powder", "whey protein"],
  sauna: ["sweat", "sauna suit", "sweat suit"],
  "sauna shorts": ["sweat shorts", "sauna short"],
  "sauna short": ["sweat shorts"],
  "sauna t-shirts": ["sweat t-shirt", "sweat shirt", "sauna t-shirt"],
  "sauna t-shirt": ["sweat t-shirt", "sweat shirt"],
  "sauna vests": ["sweat vest", "sauna vest"],
  "sauna vest": ["sweat vest"],
  "sauna leggings": ["sweat leggings", "sauna legging"],
  "sauna suits": ["sweat suit", "sauna suit"],
  "sauna suit": ["sweat suit"],
};

/**
 * Related category names for empty nav collections (e.g. Sauna Shorts ↔ Sweat Shorts).
 */
export function categoryAliasTerms(category: string): string[] {
  const term = category.trim().toLowerCase().replace(/\s+/g, " ");
  if (!term) return [];

  const aliases = new Set<string>([term]);
  const known = SEARCH_SYNONYMS[term];
  if (known) {
    for (const a of known) aliases.add(a);
  }

  // Sauna Range items are often titled / typed as "Sweat …"
  if (term.startsWith("sauna ")) {
    aliases.add(`sweat ${term.slice("sauna ".length)}`);
  } else if (term.startsWith("sweat ")) {
    aliases.add(`sauna ${term.slice("sweat ".length)}`);
  }

  // Light singular/plural for the last word
  const words = term.split(" ");
  const last = words[words.length - 1] ?? "";
  if (last.endsWith("s") && last.length > 2 && !last.endsWith("ss")) {
    aliases.add([...words.slice(0, -1), last.slice(0, -1)].join(" "));
  } else if (last) {
    aliases.add([...words.slice(0, -1), `${last}s`].join(" "));
  }

  return [...aliases].filter(Boolean);
}

function buildSearchQueries(keyword: string): string[] {
  const sanitized = keyword.replace(/["\\]/g, " ").trim();
  if (!sanitized) return [];

  const tokens = sanitized
    .split(/\s+/)
    .map((t) => t.replace(/[^a-zA-Z0-9-]/g, ""))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t.toLowerCase()));

  const queries: string[] = [sanitized];

  if (tokens.length >= 2) {
    queries.push(tokens.slice(0, 4).join(" "));
    if (tokens.length > 4) {
      queries.push(tokens.slice(-3).join(" "));
    }
  } else if (tokens.length === 1) {
    queries.push(tokens[0]!);
  }

  // Prefer productType / title field matches before giving up.
  const typeLabel = toProductTypeLabel(sanitized);
  if (typeLabel) {
    queries.push(`product_type:"${typeLabel}"`);
    queries.push(`title:*${sanitized}*`);
  }

  const expansions = SEARCH_SYNONYMS[sanitized.toLowerCase()];
  if (expansions) {
    for (const term of expansions) {
      queries.push(term);
      queries.push(`product_type:"${toProductTypeLabel(term)}"`);
    }
  }

  return [...new Set(queries.filter(Boolean))].map((q) => storefrontQuery(q));
}

async function runProductQuery(
  query: string,
  first: number,
  marketCountry: string | null,
  after: string | null = null,
  signal?: AbortSignal
): Promise<{
  products: ProductSummary[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const variables: Record<string, unknown> = { query, first, after };
  if (marketCountry) variables.country = marketCountry;

  const data = await shopifyAdminGraphql<SearchProductsData>(
    buildSearchQuery(Boolean(marketCountry)),
    variables,
    { signal }
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
  marketCountry: string | null,
  signal?: AbortSignal
): Promise<ProductSummary[]> {
  const first = Math.min(Math.max(limit, 1), MAX_RESULTS);
  const queries = buildSearchQueries(keyword);

  for (const query of queries) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const { products } = await runProductQuery(
      query,
      first,
      marketCountry,
      null,
      signal
    );
    if (products.length > 0) return products;
  }

  return [];
}

export async function searchProducts(
  keyword: string,
  limit = 5,
  options: ShopifyFetchOptions = {}
): Promise<ProductSummary[]> {
  const { marketCountry } = getShopifyConfig();
  const results = await cachedProductSearch(keyword, limit, marketCountry, () =>
    searchProductsUncached(keyword, limit, marketCountry, options.signal)
  );
  return withFreshProductUrls(results.filter(isStorefrontWorthy));
}

async function getDiscountedProductsUncached(
  limit: number,
  marketCountry: string | null,
  signal?: AbortSignal
): Promise<ProductSummary[]> {
  const capped = Math.min(Math.max(limit, 1), DISCOUNT_RESULT_LIMIT);
  const onSale: ProductSummary[] = [];
  let after: string | null = null;

  for (let page = 0; page < DISCOUNT_MAX_PAGES; page++) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const { products, hasNextPage, endCursor } = await runProductQuery(
      storefrontQuery(),
      DISCOUNT_PAGE_SIZE,
      marketCountry,
      after,
      signal
    );

    for (const p of products) {
      if (p.onSale) onSale.push(p);
      if (onSale.length >= capped) return onSale.slice(0, capped);
    }

    if (!hasNextPage || !endCursor) break;
    after = endCursor;
  }

  return withFreshProductUrls(onSale);
}

export async function getDiscountedProducts(
  limit = DISCOUNT_RESULT_LIMIT,
  options: ShopifyFetchOptions = {}
): Promise<ProductSummary[]> {
  const { marketCountry } = getShopifyConfig();
  const capped = Math.min(Math.max(limit, 1), DISCOUNT_RESULT_LIMIT);
  const results = await cachedDiscountedProducts(capped, marketCountry, () =>
    getDiscountedProductsUncached(capped, marketCountry, options.signal)
  );
  return withFreshProductUrls(results.filter(isStorefrontWorthy));
}

interface ProductsCountData {
  productsCount: { count: number; precision: string } | null;
}

/**
 * Exact count of ACTIVE products published on the Online Store
 * (same scope as catalog search). Not capped at search page size.
 */
export async function countStorefrontProducts(
  options: ShopifyFetchOptions = {}
): Promise<{ count: number; precision: string }> {
  const data = await shopifyAdminGraphql<ProductsCountData>(
    `query CountStorefrontProducts($query: String!, $limit: Int) {
      productsCount(query: $query, limit: $limit) {
        count
        precision
      }
    }`,
    { query: STOREFRONT_SCOPE, limit: null },
    { signal: options.signal }
  );

  const count = data.productsCount?.count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    throw new Error("Shopify productsCount returned an invalid count");
  }

  return {
    count,
    precision: data.productsCount?.precision ?? "EXACT",
  };
}

export interface CategoryCollectionMatch {
  id: string;
  title: string;
  handle: string;
  productsCount: number;
  precision: string;
}

export interface CategoryLookupResult {
  category: string;
  matched: CategoryCollectionMatch | null;
  /** Exact Shopify productType when that path won (e.g. "Boxing Gloves"). */
  productType: string | null;
  source: "product_type" | "collection" | "product_filter" | "none";
  totalProducts: number;
  precision: string;
  /** Sample products — only populated for list mode. */
  products: ProductSummary[];
  mode: "count" | "list";
}

interface CollectionSearchData {
  collections: {
    edges: {
      node: {
        id: string;
        title: string;
        handle: string;
        productsCount: { count: number; precision: string } | null;
      };
    }[];
  };
}

function slugifyCategory(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function scoreCollectionMatch(
  category: string,
  title: string,
  handle: string
): number {
  const c = category.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  const h = handle.trim().toLowerCase();
  const slug = slugifyCategory(category);

  // Prefer exact handle — titles can collide (e.g. multiple "Boxing Gloves").
  if (h === slug) return 100;
  if (t === c) return 95;
  if (h.includes(slug) && slug.length >= 4) return 80;
  if (t.includes(c) && c.length >= 4) return 75;
  if (slug && (h.startsWith(slug) || t.startsWith(c))) return 70;
  return 0;
}

function collectionNumericId(gid: string): string | null {
  const num = gid.split("/").pop();
  return num && /^\d+$/.test(num) ? num : null;
}

/**
 * Storefront-facing collection size: ACTIVE + published on Online Store.
 * Matches the "47 PRODUCTS" count on collection pages (not Admin's raw total).
 */
async function countPublishedCollectionProducts(
  collectionGid: string,
  options: ShopifyFetchOptions = {}
): Promise<{ count: number; precision: string } | null> {
  const num = collectionNumericId(collectionGid);
  if (!num) return null;

  const data = await shopifyAdminGraphql<ProductsCountData>(
    `query CountPublishedInCollection($query: String!, $limit: Int) {
      productsCount(query: $query, limit: $limit) {
        count
        precision
      }
    }`,
    {
      query: `collection_id:${num} AND status:ACTIVE published_status:published`,
      limit: null,
    },
    { signal: options.signal }
  );

  const count = data.productsCount?.count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return null;
  }

  return {
    count,
    precision: data.productsCount?.precision ?? "EXACT",
  };
}

/**
 * Find the best Shopify collection for a category name (e.g. "yoga", "boxing gloves").
 */
export async function findCategoryCollection(
  category: string,
  options: ShopifyFetchOptions = {}
): Promise<CategoryCollectionMatch | null> {
  const raw = category.trim();
  if (!raw) return null;

  const slug = slugifyCategory(raw);
  // Handle + quoted title first so we land on boxing-gloves (47), not sale aliases.
  const queries = [
    `handle:${slug}`,
    `title:"${raw.replace(/"/g, "")}"`,
    `title:${raw}`,
    `title:*${raw}*`,
    slug.includes("-") ? `title:*${slug.replace(/-/g, " ")}*` : null,
  ].filter(Boolean) as string[];

  let best: {
    id: string;
    title: string;
    handle: string;
    fallbackCount: number;
    fallbackPrecision: string;
  } | null = null;
  let bestScore = 0;

  for (const query of queries) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const data = await shopifyAdminGraphql<CollectionSearchData>(
      `query FindCollections($query: String!, $first: Int!) {
        collections(first: $first, query: $query) {
          edges {
            node {
              id
              title
              handle
              productsCount {
                count
                precision
              }
            }
          }
        }
      }`,
      { query, first: 20 },
      { signal: options.signal }
    );

    for (const { node } of data.collections.edges) {
      const score = scoreCollectionMatch(raw, node.title, node.handle);
      if (score < 70 || score < bestScore) continue;
      const count = node.productsCount?.count;
      if (typeof count !== "number" || !Number.isFinite(count)) continue;

      bestScore = score;
      best = {
        id: node.id,
        title: node.title,
        handle: node.handle,
        fallbackCount: count,
        fallbackPrecision: node.productsCount?.precision ?? "EXACT",
      };
      if (score >= 100) break;
    }
    if (bestScore >= 100) break;
  }

  if (!best || bestScore < 70) return null;

  // Storefront count (ACTIVE + published) — e.g. 47 for Boxing Gloves, not Admin 50.
  const published = await countPublishedCollectionProducts(best.id, options);
  return {
    id: best.id,
    title: best.title,
    handle: best.handle,
    productsCount: published?.count ?? best.fallbackCount,
    precision: published?.precision ?? best.fallbackPrecision,
  };
}

/** Title-Case for Shopify productType values (e.g. boxing gloves → Boxing Gloves). */
function toProductTypeLabel(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Singular/plural variants so "belts" still matches productType "Belt". */
function productTypeCandidates(category: string): string[] {
  const term = category.trim().replace(/["\\]/g, "").replace(/\s+/g, " ");
  if (!term) return [];

  const lower = term.toLowerCase();
  const variants = new Set<string>([term, lower, toProductTypeLabel(term)]);

  const words = lower.split(" ");
  const last = words[words.length - 1] ?? "";
  if (last.endsWith("ies") && last.length > 4) {
    const singular = `${last.slice(0, -3)}y`;
    const next = [...words.slice(0, -1), singular].join(" ");
    variants.add(next);
    variants.add(toProductTypeLabel(next));
  } else if (last.endsWith("ses") && last.length > 4) {
    const singular = last.slice(0, -2);
    const next = [...words.slice(0, -1), singular].join(" ");
    variants.add(next);
    variants.add(toProductTypeLabel(next));
  } else if (last.endsWith("s") && last.length > 2 && !last.endsWith("ss")) {
    const singular = last.slice(0, -1);
    const next = [...words.slice(0, -1), singular].join(" ");
    variants.add(next);
    variants.add(toProductTypeLabel(next));
  } else {
    const plural = `${last}s`;
    const next = [...words.slice(0, -1), plural].join(" ");
    variants.add(next);
    variants.add(toProductTypeLabel(next));
  }

  return [...variants].filter(Boolean);
}

/**
 * Exact count by Shopify productType (e.g. productType: "Boxing Gloves").
 * Uses quoted product_type so multi-word types match correctly.
 */
export async function countByProductType(
  category: string,
  options: ShopifyFetchOptions = {}
): Promise<{ count: number; precision: string; productType: string } | null> {
  const candidates = productTypeCandidates(category);
  if (candidates.length === 0) return null;

  for (const productType of candidates) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const data = await shopifyAdminGraphql<ProductsCountData>(
      `query CountByProductType($query: String!, $limit: Int) {
        productsCount(query: $query, limit: $limit) {
          count
          precision
        }
      }`,
      {
        query: `${STOREFRONT_SCOPE} AND product_type:"${productType}"`,
        limit: null,
      },
      { signal: options.signal }
    );

    const count = data.productsCount?.count;
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      return {
        count,
        precision: data.productsCount?.precision ?? "EXACT",
        productType,
      };
    }
  }

  return null;
}

function isProductInStock(product: ProductSummary): boolean {
  if (product.variants.some((v) => v.availableForSale)) return true;
  if (typeof product.totalInventory === "number" && product.totalInventory > 0) {
    return true;
  }
  return product.variants.some(
    (v) => typeof v.inventoryQuantity === "number" && v.inventoryQuantity > 0
  );
}

async function listByProductType(
  productType: string,
  limit: number,
  options: ShopifyFetchOptions = {}
): Promise<ProductSummary[]> {
  const { marketCountry } = getShopifyConfig();
  const capped = Math.min(Math.max(limit, 1), MAX_RESULTS);
  const typeClause = `product_type:"${productType.replace(/"/g, "")}"`;
  // Prefer inventory filter server-side when asking for in-stock only.
  const stockClause = options.inStockOnly ? " inventory_total:>0" : "";
  const query = storefrontQuery(`${typeClause}${stockClause}`);

  const collected: ProductSummary[] = [];
  let after: string | null = null;
  for (let page = 0; page < 4 && collected.length < capped; page++) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const { products, hasNextPage, endCursor } = await runProductQuery(
      query,
      Math.min(MAX_RESULTS, Math.max(capped, 25)),
      marketCountry,
      after,
      options.signal
    );
    for (const p of products) {
      if (options.inStockOnly && !isProductInStock(p)) continue;
      collected.push(p);
      if (collected.length >= capped) break;
    }
    if (!hasNextPage || !endCursor) break;
    after = endCursor;
  }

  return withFreshProductUrls(collected);
}

async function countProductsByFilter(
  category: string,
  options: ShopifyFetchOptions = {}
): Promise<{ count: number; precision: string }> {
  const terms = categoryAliasTerms(category);
  if (terms.length === 0) {
    return { count: 0, precision: "EXACT" };
  }

  const clauses: string[] = [];
  for (const term of terms) {
    const slug = slugifyCategory(term);
    const typeLabel = toProductTypeLabel(term);
    clauses.push(`product_type:"${typeLabel}"`);
    clauses.push(`product_type:"${term}"`);
    clauses.push(`tag:"${term}"`);
    if (slug) clauses.push(`tag:${slug}`);

    // Title tokens: "sauna shorts" → title:sauna AND title:shorts
    const tokens = term
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9-]/gi, ""))
      .filter((t) => t.length > 2);
    if (tokens.length >= 2) {
      clauses.push(`(${tokens.map((t) => `title:${t}`).join(" AND ")})`);
    } else if (tokens.length === 1) {
      clauses.push(`title:${tokens[0]}`);
    }
  }

  const filter = [...new Set(clauses)].join(" OR ");

  const data = await shopifyAdminGraphql<ProductsCountData>(
    `query CountCategoryProducts($query: String!, $limit: Int) {
      productsCount(query: $query, limit: $limit) {
        count
        precision
      }
    }`,
    {
      query: `${STOREFRONT_SCOPE} AND (${filter})`,
      limit: null,
    },
    { signal: options.signal }
  );

  const count = data.productsCount?.count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    throw new Error("Shopify productsCount returned an invalid category count");
  }

  return {
    count,
    precision: data.productsCount?.precision ?? "EXACT",
  };
}

/**
 * Best-effort product count for a category name when the nav collection is empty
 * or missing — tries productType, aliases (sauna↔sweat), tags, and title tokens.
 */
export async function estimateCategoryProductCount(
  category: string,
  options: ShopifyFetchOptions = {}
): Promise<{ count: number; precision: string; source: string }> {
  const cleaned = category.trim();
  if (!cleaned) {
    return { count: 0, precision: "EXACT", source: "none" };
  }

  for (const term of categoryAliasTerms(cleaned)) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const byType = await countByProductType(term, options);
    if (byType) {
      return {
        count: byType.count,
        precision: byType.precision,
        source: "product_type",
      };
    }
  }

  const filtered = await countProductsByFilter(cleaned, options);
  if (filtered.count > 0) {
    return {
      count: filtered.count,
      precision: filtered.precision,
      source: "product_filter",
    };
  }

  return { count: 0, precision: "EXACT", source: "none" };
}

const CATEGORY_LIST_LIMIT = 12;

function resolveCategoryListLimit(options: ShopifyFetchOptions): number {
  const requested = options.limit;
  if (typeof requested === "number" && Number.isFinite(requested)) {
    return Math.min(Math.max(Math.floor(requested), 1), MAX_RESULTS);
  }
  return CATEGORY_LIST_LIMIT;
}

/**
 * Look up a store category: exact productType, then collection, then tag filters.
 * productType (e.g. "Boxing Gloves") is checked explicitly — not only collections.
 */
export async function lookupCategory(
  category: string,
  mode: "count" | "list" = "count",
  options: ShopifyFetchOptions = {}
): Promise<CategoryLookupResult> {
  const cleaned = category.trim();
  const inStockOnly = Boolean(options.inStockOnly);
  const listLimit = resolveCategoryListLimit(options);
  if (!cleaned) {
    return {
      category: "",
      matched: null,
      productType: null,
      source: "none",
      totalProducts: 0,
      precision: "EXACT",
      products: [],
      mode,
    };
  }

  const [byType, matched] = await Promise.all([
    countByProductType(cleaned, options),
    findCategoryCollection(cleaned, options),
  ]);

  // Prefer exact productType when present — matches Shopify product.productType.
  if (byType) {
    let products: ProductSummary[] = [];
    if (mode === "list") {
      products = await listByProductType(byType.productType, listLimit, {
        ...options,
        inStockOnly,
      });
      // Fallback if listing fails but count succeeded (same productType).
      if (products.length === 0 && matched && matched.productsCount > 0) {
        products = await listCollectionProducts(matched.id, listLimit, {
          ...options,
          inStockOnly,
        });
      }
      // In-stock filter can over-filter — retry without server inventory clause.
      if (products.length === 0 && inStockOnly) {
        const unfiltered = await listByProductType(
          byType.productType,
          listLimit,
          { ...options, inStockOnly: false }
        );
        products = unfiltered.filter(isProductInStock);
        if (products.length === 0 && matched && matched.productsCount > 0) {
          const fromCollection = await listCollectionProducts(
            matched.id,
            listLimit,
            { ...options, inStockOnly: false }
          );
          products = fromCollection.filter(isProductInStock);
        }
      }
      if (products.length === 0 && !inStockOnly) {
        products = await searchProductsWithAliases(cleaned, listLimit, options);
      }
    }
    return {
      category: cleaned,
      matched,
      productType: byType.productType,
      source: "product_type",
      totalProducts: byType.count,
      precision: byType.precision,
      products,
      mode,
    };
  }

  // Non-empty collection match wins. Empty nav collections fall through —
  // many stores leave subcategory collections empty while products exist
  // under related titles/types (e.g. Sauna Shorts → Sweat Shorts).
  if (matched && matched.productsCount > 0) {
    let products: ProductSummary[] = [];
    if (mode === "list") {
      products = await listCollectionProducts(matched.id, listLimit, {
        ...options,
        inStockOnly,
      });
      if (products.length === 0 && !inStockOnly) {
        products = await searchProductsWithAliases(cleaned, listLimit, options);
      }
    }
    return {
      category: cleaned,
      matched,
      productType: null,
      source: "collection",
      totalProducts: matched.productsCount,
      precision: matched.precision,
      products,
      mode,
    };
  }

  // Try productType on aliases before the broad filter.
  for (const alias of categoryAliasTerms(cleaned)) {
    if (alias.toLowerCase() === cleaned.toLowerCase()) continue;
    const aliasType = await countByProductType(alias, options);
    if (!aliasType) continue;
    let products: ProductSummary[] = [];
    if (mode === "list") {
      products = await listByProductType(aliasType.productType, listLimit, {
        ...options,
        inStockOnly,
      });
      if (products.length === 0 && !inStockOnly) {
        products = await searchProductsWithAliases(cleaned, listLimit, options);
      }
    }
    return {
      category: cleaned,
      matched,
      productType: aliasType.productType,
      source: "product_type",
      totalProducts: aliasType.count,
      precision: aliasType.precision,
      products,
      mode,
    };
  }

  const filtered = await countProductsByFilter(cleaned, options);
  let products: ProductSummary[] = [];
  if (mode === "list" && filtered.count > 0) {
    products = await searchProductsWithAliases(cleaned, listLimit, options);
  } else if (mode === "list" && filtered.count === 0) {
    products = await searchProductsWithAliases(cleaned, listLimit, options);
  }

  const totalProducts =
    filtered.count > 0
      ? filtered.count
      : products.length > 0
        ? products.length
        : matched?.productsCount ?? 0;

  return {
    category: cleaned,
    matched,
    productType: null,
    source:
      filtered.count > 0
        ? "product_filter"
        : products.length > 0
          ? "product_filter"
          : "none",
    totalProducts,
    precision: filtered.count > 0 ? filtered.precision : "AT_LEAST",
    products,
    mode,
  };
}

async function searchProductsWithAliases(
  category: string,
  limit: number,
  options: ShopifyFetchOptions
): Promise<ProductSummary[]> {
  for (const term of categoryAliasTerms(category)) {
    const found = await searchProducts(term, limit, options);
    if (found.length > 0) return found;
  }
  return [];
}

interface CollectionProductsData {
  collection: {
    id: string;
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: { node: RawProductNode }[];
    };
  } | null;
}

async function listCollectionProducts(
  collectionId: string,
  limit: number,
  options: ShopifyFetchOptions = {}
): Promise<ProductSummary[]> {
  const { marketCountry } = getShopifyConfig();
  const capped = Math.min(Math.max(limit, 1), MAX_RESULTS);
  const withMarket = Boolean(marketCountry);

  const productPricing = withMarket
    ? `contextualPricing(context: { country: $country }) {
        minVariantPricing { price { amount currencyCode } }
        maxVariantPricing { price { amount currencyCode } }
      }`
    : `priceRangeV2 {
        minVariantPrice { amount currencyCode }
        maxVariantPrice { amount currencyCode }
      }`;

  const variantPricing = withMarket
    ? `price
       compareAtPrice
       contextualPricing(context: { country: $country }) {
         price { amount currencyCode }
         compareAtPrice { amount currencyCode }
       }`
    : `price
       compareAtPrice`;

  const vars = withMarket
    ? `$id: ID!, $first: Int!, $after: String, $country: CountryCode!`
    : `$id: ID!, $first: Int!, $after: String`;

  const query = `
    query CollectionProducts(${vars}) {
      collection(id: $id) {
        id
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              handle
              onlineStoreUrl
              status
              description(truncateAt: 200)
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
      }
    }`;

  const collected: ProductSummary[] = [];
  let after: string | null = null;
  for (let page = 0; page < 4 && collected.length < capped; page++) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const variables: Record<string, unknown> = {
      id: collectionId,
      first: Math.min(MAX_RESULTS, Math.max(capped, 25)),
      after,
    };
    if (marketCountry) variables.country = marketCountry;

    const data = await shopifyAdminGraphql<CollectionProductsData>(
      query,
      variables,
      { signal: options.signal }
    );

    const connection = data.collection?.products;
    const pageProducts = (connection?.edges ?? [])
      .map((e) => toProductSummary(e.node))
      .filter(isStorefrontWorthy);

    for (const p of pageProducts) {
      if (options.inStockOnly && !isProductInStock(p)) continue;
      collected.push(p);
      if (collected.length >= capped) break;
    }

    if (!connection?.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }
    after = connection.pageInfo.endCursor;
  }

  return withFreshProductUrls(collected);
}
