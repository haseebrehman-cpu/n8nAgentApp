/**
 * Shopify Admin GraphQL — exact product / variant inventory quantities.
 *
 * Requires Admin API scope: read_products
 * (Product.totalInventory, ProductVariant.inventoryQuantity, tracksInventory)
 */

import { shopifyAdminGraphql } from "@/lib/shopify/admin-client";
import { parseCatalogGid } from "@/lib/shopify/gid";
import type {
  ShopifyStoreCredentials,
  ShopifyStoreRegion,
} from "@/services/shopify/credentials";
import { resolveShopifyStore } from "@/services/shopify/credentials";

export interface VariantInventory {
  id: string;
  title: string;
  sku: string | null;
  options: { name: string; value: string }[];
  /** null when the product does not track inventory */
  inventoryQuantity: number | null;
}

export interface ProductInventoryResult {
  found: boolean;
  productId: string;
  productTitle: string;
  tracksInventory: boolean;
  /** null when not tracked or not found */
  totalInventory: number | null;
  variants: VariantInventory[];
  /** Populated for variant-scoped lookups */
  variantId?: string | null;
  message?: string;
}

export interface FetchInventoryOptions {
  region?: ShopifyStoreRegion;
  credentials?: ShopifyStoreCredentials;
  signal?: AbortSignal;
}

interface AdminSelectedOption {
  name?: string | null;
  value?: string | null;
}

interface AdminVariantNode {
  id: string;
  title?: string | null;
  sku?: string | null;
  inventoryQuantity?: number | null;
  selectedOptions?: AdminSelectedOption[] | null;
}

interface AdminProductNode {
  id: string;
  title?: string | null;
  totalInventory?: number | null;
  tracksInventory?: boolean | null;
  variants?: { nodes?: AdminVariantNode[] | null } | null;
}

interface ProductInventoryQueryData {
  product: AdminProductNode | null;
}

interface VariantInventoryQueryData {
  productVariant: {
    id: string;
    title?: string | null;
    sku?: string | null;
    inventoryQuantity?: number | null;
    selectedOptions?: AdminSelectedOption[] | null;
    product?: AdminProductNode | null;
  } | null;
}

interface NodesInventoryQueryData {
  nodes: Array<
    | (AdminProductNode & { __typename?: string })
    | (AdminVariantNode & {
        __typename?: string;
        product?: AdminProductNode | null;
      })
    | null
  > | null;
}

const PRODUCT_INVENTORY_QUERY = `#graphql
  query ProductInventory($id: ID!) {
    product(id: $id) {
      id
      title
      totalInventory
      tracksInventory
      variants(first: 100) {
        nodes {
          id
          title
          sku
          inventoryQuantity
          selectedOptions {
            name
            value
          }
        }
      }
    }
  }
`;

const VARIANT_INVENTORY_QUERY = `#graphql
  query VariantInventory($id: ID!) {
    productVariant(id: $id) {
      id
      title
      sku
      inventoryQuantity
      selectedOptions {
        name
        value
      }
      product {
        id
        title
        totalInventory
        tracksInventory
      }
    }
  }
`;

const NODES_INVENTORY_QUERY = `#graphql
  query CatalogInventory($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        __typename
        id
        title
        totalInventory
        tracksInventory
        variants(first: 100) {
          nodes {
            id
            title
            sku
            inventoryQuantity
            selectedOptions {
              name
              value
            }
          }
        }
      }
      ... on ProductVariant {
        __typename
        id
        title
        sku
        inventoryQuantity
        selectedOptions {
          name
          value
        }
        product {
          id
          title
          totalInventory
          tracksInventory
        }
      }
    }
  }
`;

function mapVariant(
  node: AdminVariantNode,
  tracksInventory: boolean,
): VariantInventory {
  const options = (node.selectedOptions ?? [])
    .filter((o): o is { name: string; value: string } =>
      Boolean(o?.name && o?.value),
    )
    .map((o) => ({ name: String(o.name), value: String(o.value) }));

  return {
    id: node.id,
    title: String(node.title ?? "").trim() || "Default",
    sku: typeof node.sku === "string" && node.sku.trim() ? node.sku.trim() : null,
    options,
    inventoryQuantity: tracksInventory
      ? typeof node.inventoryQuantity === "number"
        ? node.inventoryQuantity
        : 0
      : null,
  };
}

function fromProductNode(
  product: AdminProductNode,
  variantId?: string | null,
): ProductInventoryResult {
  const tracksInventory = product.tracksInventory === true;
  const title = String(product.title ?? "").trim();
  const variants = (product.variants?.nodes ?? []).map((v) =>
    mapVariant(v, tracksInventory),
  );

  return {
    found: true,
    productId: product.id,
    productTitle: title,
    tracksInventory,
    totalInventory: tracksInventory
      ? typeof product.totalInventory === "number"
        ? product.totalInventory
        : 0
      : null,
    variants,
    variantId: variantId ?? null,
    message: tracksInventory
      ? undefined
      : "This product does not track inventory quantities. Report in-stock / out-of-stock from catalog availability only — do not invent a unit count.",
  };
}

/**
 * Exact inventory for one product (all variants) or one variant GID.
 * Returns null for invalid ids; `{ found: false }` when Shopify has no match.
 */
export async function fetchProductInventory(
  id: string,
  options: FetchInventoryOptions = {},
): Promise<ProductInventoryResult | null> {
  const parsed = parseCatalogGid(id);
  if (!parsed) return null;

  const credentials =
    options.credentials ?? resolveShopifyStore(options.region ?? "default");

  if (parsed.kind === "variant") {
    const data = await shopifyAdminGraphql<VariantInventoryQueryData>(
      VARIANT_INVENTORY_QUERY,
      { id: parsed.gid },
      { credentials, signal: options.signal },
    );
    const variant = data.productVariant;
    if (!variant?.product?.id) {
      return {
        found: false,
        productId: parsed.gid,
        productTitle: "",
        tracksInventory: false,
        totalInventory: null,
        variants: [],
        variantId: parsed.gid,
        message: "No product/variant found for that id.",
      };
    }
    const result = fromProductNode(variant.product, variant.id);
    // Prefer the single variant when the caller asked for a variant id.
    const tracks = result.tracksInventory;
    result.variants = [
      mapVariant(
        {
          id: variant.id,
          title: variant.title,
          sku: variant.sku,
          inventoryQuantity: variant.inventoryQuantity,
          selectedOptions: variant.selectedOptions,
        },
        tracks,
      ),
    ];
    if (tracks) {
      result.totalInventory =
        typeof variant.inventoryQuantity === "number"
          ? variant.inventoryQuantity
          : 0;
    }
    return result;
  }

  const data = await shopifyAdminGraphql<ProductInventoryQueryData>(
    PRODUCT_INVENTORY_QUERY,
    { id: parsed.gid },
    { credentials, signal: options.signal },
  );

  if (!data.product?.id) {
    return {
      found: false,
      productId: parsed.gid,
      productTitle: "",
      tracksInventory: false,
      totalInventory: null,
      variants: [],
      message: "No product found for that id.",
    };
  }

  return fromProductNode(data.product);
}

/**
 * Batch inventory lookup for up to 10 product/variant GIDs.
 */
export async function fetchInventoryByIds(
  ids: string[],
  options: FetchInventoryOptions = {},
): Promise<ProductInventoryResult[]> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const parsed = parseCatalogGid(raw);
    if (!parsed) continue;
    if (seen.has(parsed.gid)) continue;
    seen.add(parsed.gid);
    unique.push(parsed.gid);
    if (unique.length >= 10) break;
  }

  if (unique.length === 0) return [];

  const credentials =
    options.credentials ?? resolveShopifyStore(options.region ?? "default");

  const data = await shopifyAdminGraphql<NodesInventoryQueryData>(
    NODES_INVENTORY_QUERY,
    { ids: unique },
    { credentials, signal: options.signal },
  );

  const results: ProductInventoryResult[] = [];
  for (const node of data.nodes ?? []) {
    if (!node || typeof node !== "object" || !("id" in node)) continue;

    const typename = String(
      (node as { __typename?: string }).__typename ?? "",
    );

    if (typename === "Product" || ("tracksInventory" in node && "variants" in node)) {
      results.push(fromProductNode(node as AdminProductNode));
      continue;
    }

    if (
      typename === "ProductVariant" ||
      ("inventoryQuantity" in node && "product" in node)
    ) {
      const variant = node as AdminVariantNode & {
        product?: AdminProductNode | null;
      };
      if (!variant.product?.id) {
        results.push({
          found: false,
          productId: variant.id,
          productTitle: "",
          tracksInventory: false,
          totalInventory: null,
          variants: [],
          variantId: variant.id,
          message: "No product found for that variant id.",
        });
        continue;
      }
      const result = fromProductNode(variant.product, variant.id);
      const tracks = result.tracksInventory;
      result.variants = [mapVariant(variant, tracks)];
      if (tracks) {
        result.totalInventory =
          typeof variant.inventoryQuantity === "number"
            ? variant.inventoryQuantity
            : 0;
      }
      results.push(result);
    }
  }

  return results;
}
