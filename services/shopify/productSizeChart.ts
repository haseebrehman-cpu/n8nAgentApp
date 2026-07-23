/**
 * Shopify Admin GraphQL — resolve a product's size-chart metafield.
 *
 * Requires Admin API scope: read_products
 *
 * Default metafield: custom.sizeguide (file_reference or url), matching the
 * live RDX store. Also tries size_chart / size_guide when no env override is set.
 * Override with SHOPIFY_SIZE_CHART_METAFIELD_NAMESPACE / _KEY.
 */

import { shopifyAdminGraphql } from "@/lib/shopify/admin-client";
import {
  isAllowedSizeChartUrl,
  toShopifyProductGid,
} from "@/lib/shopify/size-chart-url";
import type {
  ShopifyStoreCredentials,
  ShopifyStoreRegion,
} from "@/services/shopify/credentials";
import { resolveShopifyStore } from "@/services/shopify/credentials";

export interface ProductSizeChart {
  productId: string;
  productTitle: string;
  url: string;
  altText: string;
  width: number | null;
  height: number | null;
}

export interface FetchProductSizeChartOptions {
  region?: ShopifyStoreRegion;
  credentials?: ShopifyStoreCredentials;
  signal?: AbortSignal;
  /** Metafield namespace (default: custom, or SHOPIFY_SIZE_CHART_METAFIELD_NAMESPACE). */
  namespace?: string;
  /** Metafield key (default: sizeguide, or SHOPIFY_SIZE_CHART_METAFIELD_KEY). */
  key?: string;
}

interface MetafieldImage {
  url?: string | null;
  altText?: string | null;
  width?: number | null;
  height?: number | null;
}

interface MetafieldReference {
  image?: MetafieldImage | null;
  url?: string | null;
}

interface MetafieldNode {
  type?: string | null;
  value?: string | null;
  reference?: MetafieldReference | null;
}

interface ProductSizeChartQueryData {
  product: {
    id: string;
    title: string;
    sizeguide?: MetafieldNode | null;
    size_chart?: MetafieldNode | null;
    size_guide?: MetafieldNode | null;
    metafield?: MetafieldNode | null;
  } | null;
}

/** Keys tried when no explicit env/options override is set (store uses sizeguide). */
export const DEFAULT_SIZE_CHART_KEYS = [
  "sizeguide",
  "size_chart",
  "size_guide",
] as const;

const METAFIELD_SELECTION = `
  type
  value
  reference {
    ... on MediaImage {
      image {
        url
        altText
        width
        height
      }
    }
    ... on GenericFile {
      url
    }
  }
`;

const PRODUCT_SIZE_CHART_MULTI_QUERY = `#graphql
  query ProductSizeChartMulti($id: ID!, $namespace: String!) {
    product(id: $id) {
      id
      title
      sizeguide: metafield(namespace: $namespace, key: "sizeguide") {
        ${METAFIELD_SELECTION}
      }
      size_chart: metafield(namespace: $namespace, key: "size_chart") {
        ${METAFIELD_SELECTION}
      }
      size_guide: metafield(namespace: $namespace, key: "size_guide") {
        ${METAFIELD_SELECTION}
      }
    }
  }
`;

const PRODUCT_SIZE_CHART_SINGLE_QUERY = `#graphql
  query ProductSizeChart($id: ID!, $namespace: String!, $key: String!) {
    product(id: $id) {
      id
      title
      metafield(namespace: $namespace, key: $key) {
        ${METAFIELD_SELECTION}
      }
    }
  }
`;

function metafieldNamespace(override?: string): string {
  return (
    override?.trim() ||
    process.env.SHOPIFY_SIZE_CHART_METAFIELD_NAMESPACE?.trim() ||
    "custom"
  );
}

/** Explicit key from options or env — when set, only that key is queried. */
function explicitMetafieldKey(override?: string): string | null {
  const key =
    override?.trim() ||
    process.env.SHOPIFY_SIZE_CHART_METAFIELD_KEY?.trim() ||
    "";
  return key || null;
}

export function pickUrlFromMetafield(field: MetafieldNode | null | undefined): {
  url: string | null;
  altText: string | null;
  width: number | null;
  height: number | null;
} {
  if (!field) {
    return { url: null, altText: null, width: null, height: null };
  }

  const image = field.reference?.image;
  if (image?.url && typeof image.url === "string") {
    return {
      url: image.url.trim(),
      altText: typeof image.altText === "string" ? image.altText.trim() : null,
      width: typeof image.width === "number" ? image.width : null,
      height: typeof image.height === "number" ? image.height : null,
    };
  }

  const genericUrl = field.reference?.url;
  if (typeof genericUrl === "string" && genericUrl.trim()) {
    return {
      url: genericUrl.trim(),
      altText: null,
      width: null,
      height: null,
    };
  }

  // url / single_line_text_field metafields store the URL in `value`.
  const type = String(field.type ?? "").toLowerCase();
  if (
    (type === "url" ||
      type.includes("url") ||
      type === "single_line_text_field") &&
    typeof field.value === "string" &&
    field.value.trim()
  ) {
    return {
      url: field.value.trim(),
      altText: null,
      width: null,
      height: null,
    };
  }

  // Some stores paste a raw URL into value regardless of type.
  if (
    typeof field.value === "string" &&
    /^https:\/\//i.test(field.value.trim())
  ) {
    return {
      url: field.value.trim(),
      altText: null,
      width: null,
      height: null,
    };
  }

  return { url: null, altText: null, width: null, height: null };
}

function firstValidChartFromFields(
  product: NonNullable<ProductSizeChartQueryData["product"]>,
  fields: (MetafieldNode | null | undefined)[],
): ProductSizeChart | null {
  const title = product.title.trim();
  if (!product.id || !title) return null;

  for (const field of fields) {
    const picked = pickUrlFromMetafield(field);
    if (!picked.url || !isAllowedSizeChartUrl(picked.url)) continue;
    return {
      productId: product.id,
      productTitle: title,
      url: picked.url,
      altText: picked.altText || `Size chart for ${title}`,
      width: picked.width,
      height: picked.height,
    };
  }
  return null;
}

/**
 * Fetch and validate the size-chart image for a product.
 * Returns null when the product is missing, has no metafield, or the URL fails allowlisting.
 */
export async function fetchProductSizeChart(
  productId: string,
  options: FetchProductSizeChartOptions = {},
): Promise<ProductSizeChart | null> {
  const gid = toShopifyProductGid(productId);
  if (!gid) return null;

  const credentials =
    options.credentials ?? resolveShopifyStore(options.region ?? "default");
  const namespace = metafieldNamespace(options.namespace);
  const explicitKey = explicitMetafieldKey(options.key);

  if (explicitKey) {
    const data = await shopifyAdminGraphql<ProductSizeChartQueryData>(
      PRODUCT_SIZE_CHART_SINGLE_QUERY,
      { id: gid, namespace, key: explicitKey },
      { credentials, signal: options.signal },
    );
    const product = data.product;
    if (!product) return null;
    return firstValidChartFromFields(product, [product.metafield]);
  }

  const data = await shopifyAdminGraphql<ProductSizeChartQueryData>(
    PRODUCT_SIZE_CHART_MULTI_QUERY,
    { id: gid, namespace },
    { credentials, signal: options.signal },
  );

  const product = data.product;
  if (!product) return null;

  return firstValidChartFromFields(product, [
    product.sizeguide,
    product.size_chart,
    product.size_guide,
  ]);
}
