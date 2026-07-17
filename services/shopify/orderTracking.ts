/**
 * Shopify Admin GraphQL — order lookup for tracking.
 *
 * Requires the Admin API scope: read_orders
 *
 * Important: many stores use custom order names (e.g. "OT-cbn4m5p8cd") that do
 * NOT contain the integer Order.number (e.g. 1044). Lookups for numeric input
 * must match Order.number — never rely on name alone.
 *
 * Public traffic is limited to cheap search queries (≤3). Full-catalog scans
 * are intentionally not supported.
 */

import { shopifyAdminGraphql } from "@/lib/shopify/admin-client";
import type {
  ShopifyStoreCredentials,
  ShopifyStoreRegion,
} from "@/services/shopify/credentials";
import { resolveShopifyStore } from "@/services/shopify/credentials";

const SEARCH_PAGE_SIZE = 25;
/** Hard budget: cheap searches only (no catalog walk). */
const MAX_SEARCH_QUERIES = 3;

export interface ShopifyTrackingInfo {
  company: string | null;
  number: string | null;
  url: string | null;
}

export interface ShopifyFulfillment {
  id: string;
  status: string;
  createdAt: string;
  trackingInfo: ShopifyTrackingInfo[];
}

export interface ShopifyOrderCustomer {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

/** Minimal shipping fields — never expose full street address publicly. */
export interface ShopifyShippingAddress {
  zip: string | null;
  country: string | null;
}

/** Normalized order shape returned to business logic. */
export interface ShopifyOrderRecord {
  id: string;
  name: string;
  /**
   * Shopify Order.number — integer order number (e.g. 1044).
   * This is what customers type when tracking, not the custom `name`.
   */
  number: number | null;
  email: string | null;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  customer: ShopifyOrderCustomer | null;
  shippingAddress: ShopifyShippingAddress | null;
  fulfillments: ShopifyFulfillment[];
}

interface RawTrackingInfo {
  company: string | null;
  number: string | null;
  url: string | null;
}

interface RawFulfillment {
  id: string;
  status: string;
  createdAt: string;
  trackingInfo: RawTrackingInfo[];
}

interface RawOrderNode {
  id: string;
  name: string;
  number: number;
  email: string | null;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  customer: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  shippingAddress: {
    zip: string | null;
    country: string | null;
  } | null;
  fulfillments: RawFulfillment[];
}

interface OrdersSearchData {
  orders: {
    edges: { node: RawOrderNode }[];
  };
}

const ORDER_NODE_SELECTION = `
  id
  name
  number
  email
  createdAt
  displayFinancialStatus
  displayFulfillmentStatus
  customer {
    email
    firstName
    lastName
  }
  shippingAddress {
    zip
    country
  }
  fulfillments(first: 10) {
    id
    status
    createdAt
    trackingInfo(first: 5) {
      company
      number
      url
    }
  }
`;

const ORDER_SEARCH_QUERY = `
  query SearchOrders($query: String!, $first: Int!) {
    orders(first: $first, query: $query, sortKey: RELEVANCE) {
      edges {
        node {
          ${ORDER_NODE_SELECTION}
        }
      }
    }
  }
`;

function mapOrder(node: RawOrderNode): ShopifyOrderRecord {
  const email =
    node.email?.trim() ||
    node.customer?.email?.trim() ||
    null;

  return {
    id: node.id,
    name: node.name,
    number: typeof node.number === "number" ? node.number : null,
    email,
    createdAt: node.createdAt,
    displayFinancialStatus: node.displayFinancialStatus,
    displayFulfillmentStatus: node.displayFulfillmentStatus,
    customer: node.customer
      ? {
          email: node.customer.email,
          firstName: node.customer.firstName,
          lastName: node.customer.lastName,
        }
      : null,
    shippingAddress: node.shippingAddress
      ? {
          zip: node.shippingAddress.zip,
          country: node.shippingAddress.country,
        }
      : null,
    fulfillments: (node.fulfillments ?? []).map((f) => ({
      id: f.id,
      status: f.status,
      createdAt: f.createdAt,
      trackingInfo: (f.trackingInfo ?? []).map((t) => ({
        company: t.company,
        number: t.number,
        url: t.url,
      })),
    })),
  };
}

/** Search query variants. Numeric lookups never depend on name equality alone. */
export function buildOrderSearchQueries(normalized: string): string[] {
  const bare = normalized.replace(/^#/, "").trim();
  const queries = new Set<string>();

  if (/^\d+$/.test(bare)) {
    queries.add(`number:${bare}`);
    queries.add(`name:${bare}`);
    queries.add(`name:#${bare}`);
    return [...queries].slice(0, MAX_SEARCH_QUERIES);
  }

  queries.add(`name:${bare}`);
  queries.add(`name:"${bare}"`);
  queries.add(bare);
  return [...queries].slice(0, MAX_SEARCH_QUERIES);
}

async function searchOrders(
  credentials: ShopifyStoreCredentials,
  query: string,
  signal?: AbortSignal
): Promise<RawOrderNode[]> {
  try {
    const data = await shopifyAdminGraphql<OrdersSearchData>(
      ORDER_SEARCH_QUERY,
      { query, first: SEARCH_PAGE_SIZE },
      { credentials, signal }
    );
    return data.orders.edges.map((e) => e.node);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || /aborted/i.test(err.message))
    ) {
      throw err;
    }
    // RELEVANCE can fail on some shops — retry with CREATED_AT.
    const fallbackQuery = `
      query SearchOrdersCreated($query: String!, $first: Int!) {
        orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges { node { ${ORDER_NODE_SELECTION} } }
        }
      }
    `;
    const data = await shopifyAdminGraphql<OrdersSearchData>(
      fallbackQuery,
      { query, first: SEARCH_PAGE_SIZE },
      { credentials, signal }
    );
    return data.orders.edges.map((e) => e.node);
  }
}

/**
 * Search Shopify for an order.
 * - Numeric input (1044 / #1044) → match Order.number
 * - Name input (OT-cbn4m5p8cd) → match Order.name
 *
 * Does not scan the full order catalog.
 */
export async function findOrderByNumber(
  normalizedOrderNumber: string,
  options?: {
    region?: ShopifyStoreRegion;
    credentials?: ShopifyStoreCredentials;
    signal?: AbortSignal;
  }
): Promise<ShopifyOrderRecord | null> {
  const credentials =
    options?.credentials ?? resolveShopifyStore(options?.region ?? "default");

  const bare = normalizedOrderNumber.replace(/^#/, "").trim();
  const isNumeric = /^\d+$/.test(bare);
  const targetNumber = isNumeric ? Number.parseInt(bare, 10) : null;

  for (const query of buildOrderSearchQueries(bare)) {
    const nodes = await searchOrders(credentials, query, options?.signal);

    const match = nodes.find((node) => {
      if (targetNumber != null) {
        return node.number === targetNumber;
      }
      return node.name.trim().replace(/^#/, "").toLowerCase() === bare.toLowerCase();
    });

    if (match) return mapOrder(match);
  }

  return null;
}
