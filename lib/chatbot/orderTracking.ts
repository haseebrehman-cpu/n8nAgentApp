/**
 * Order-tracking business logic and customer-facing response formatting.
 * GraphQL lives in services/shopify/orderTracking.ts — keep this file store-agnostic.
 *
 * Public lookups require order number + email ownership verification.
 */

import { isConfigError } from "@/lib/config";
import type { ShopifyStoreRegion } from "@/services/shopify/credentials";
import {
  findOrderByNumber,
  type ShopifyFulfillment,
  type ShopifyOrderRecord,
  type ShopifyTrackingInfo,
} from "@/services/shopify/orderTracking";

/** Structured tracking statuses returned by the API. */
export type OrderTrackingStatus =
  | "not_found"
  | "unfulfilled"
  | "fulfilled"
  | "fulfilled_no_tracking"
  | "partially_fulfilled"
  | "other";

export interface OrderTrackingShipment {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  fulfillmentStatus: string | null;
  createdAt: string | null;
}

export interface OrderTrackingOrderPayload {
  name: string;
  /** Shopify Order.number (integer), e.g. 1009 */
  number: number | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  orderDate: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  shippingStatus?: string | null;
  shipments?: OrderTrackingShipment[];
}

/** Display label for the customer — always Order.number when present. */
function formatOrderNumberLabel(order: ShopifyOrderRecord): string {
  if (order.number != null) return String(order.number);
  return order.name.replace(/^#/, "") || order.name;
}

export interface OrderTrackingResult {
  success: boolean;
  status: OrderTrackingStatus;
  message: string;
  order?: OrderTrackingOrderPayload;
  /** Set when the input failed validation before Shopify was called. */
  errorCode?: "invalid_order_number" | "invalid_email" | "email_required";
}

export class OrderTrackingError extends Error {
  readonly statusCode: number;
  readonly code: "shopify_error" | "config_error" | "network_error";

  constructor(
    message: string,
    statusCode: number,
    code: OrderTrackingError["code"]
  ) {
    super(message);
    this.name = "OrderTrackingError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Normalize customer input into a searchable order name/number.
 * Accepts: 1001 | #1001 | OT-cbn4m39wmd | "order #1001"
 */
export function normalizeOrderNumber(raw: string): string | null {
  let input = raw.trim();
  if (!input) return null;

  const embedded = input.match(
    /(?:order(?:\s*(?:number|no\.?|#))?|number|#)\s*[#:]?\s*([A-Za-z0-9][\w.-]{1,39})\b/i
  );
  if (embedded?.[1]) {
    input = embedded[1];
  } else {
    if (input.split(/\s+/).length > 3 || input.length > 48) return null;
    input = input.replace(/^(order(?:\s*(?:number|no\.?))?\s+)/i, "").trim();
  }

  input = input.replace(/^#+/, "").trim();
  if (!input) return null;

  // Order names are numeric (#1001) or alphanumeric with digits (OT-cbn4m39wmd).
  // Reject greetings / words like "hi", "hello", "ok" that match the shape but
  // are never order numbers.
  if (!/^[A-Za-z0-9][\w.-]{0,39}$/.test(input)) return null;
  if (!/\d/.test(input)) return null;

  return input;
}

export function isValidOrderNumberInput(raw: string): boolean {
  return normalizeOrderNumber(raw) !== null;
}

/** Normalize email for comparison (trim + lowercase). */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  // Practical RFC 5322-ish check — rejects obvious garbage without being pedantic.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function isValidEmailInput(raw: string): boolean {
  return normalizeEmail(raw) !== null;
}

/** Generic not-found — identical for miss and email mismatch (no enumeration oracle). */
const NOT_FOUND_MESSAGE =
  "I couldn't find an order matching that order number and email. Please double-check both — the email must be the one used at checkout — and try again.";

function emailsMatch(orderEmail: string | null, provided: string): boolean {
  const a = normalizeEmail(orderEmail ?? "");
  const b = normalizeEmail(provided);
  return Boolean(a && b && a === b);
}

function formatOrderDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function firstUsableTracking(
  fulfillments: ShopifyFulfillment[]
): ShopifyTrackingInfo | null {
  for (const f of fulfillments) {
    for (const t of f.trackingInfo ?? []) {
      if (t.number || t.url || t.company) return t;
    }
  }
  return null;
}

function hasAnyTracking(fulfillments: ShopifyFulfillment[]): boolean {
  return firstUsableTracking(fulfillments) !== null;
}

function mapShipments(fulfillments: ShopifyFulfillment[]): OrderTrackingShipment[] {
  return fulfillments.map((f) => {
    const t = (f.trackingInfo ?? []).find((x) => x.number || x.url || x.company) ?? null;
    return {
      carrier: t?.company ?? null,
      trackingNumber: t?.number ?? null,
      trackingUrl: t?.url ?? null,
      fulfillmentStatus: f.status ?? null,
      createdAt: f.createdAt ?? null,
    };
  });
}

function buildUnfulfilled(order: ShopifyOrderRecord): OrderTrackingResult {
  const orderDate = formatOrderDate(order.createdAt);
  const orderNumber = formatOrderNumberLabel(order);
  const message = [
    "Your order has not yet been shipped.",
    "",
    `**Order Number:** ${orderNumber}`,
    `**Financial Status:** ${order.displayFinancialStatus ?? "Unknown"}`,
    `**Order Date:** ${orderDate ?? "Unknown"}`,
  ].join("\n");

  return {
    success: true,
    status: "unfulfilled",
    message,
    order: {
      name: order.name,
      number: order.number,
      financialStatus: order.displayFinancialStatus,
      fulfillmentStatus: order.displayFulfillmentStatus,
      orderDate,
    },
  };
}

function buildFulfilledWithTracking(order: ShopifyOrderRecord): OrderTrackingResult {
  const tracking = firstUsableTracking(order.fulfillments)!;
  const shippingStatus = order.displayFulfillmentStatus ?? "FULFILLED";

  const trackHere =
    tracking.url != null && tracking.url.length > 0
      ? `[${tracking.url}](${tracking.url})`
      : "Not provided";

  const orderNumber = formatOrderNumberLabel(order);
  const message = [
    "Your order has been shipped.",
    "",
    `**Order Number:** ${orderNumber}`,
    `**Carrier:** ${tracking.company ?? "Not provided"}`,
    `**Tracking Number:** ${tracking.number ?? "Not provided"}`,
    `**Track Here:** ${trackHere}`,
    `**Shipping Status:** ${shippingStatus}`,
  ].join("\n");

  return {
    success: true,
    status: "fulfilled",
    message,
    order: {
      name: order.name,
      number: order.number,
      financialStatus: order.displayFinancialStatus,
      fulfillmentStatus: order.displayFulfillmentStatus,
      orderDate: formatOrderDate(order.createdAt),
      carrier: tracking.company,
      trackingNumber: tracking.number,
      trackingUrl: tracking.url,
      shippingStatus,
    },
  };
}

function buildFulfilledNoTracking(order: ShopifyOrderRecord): OrderTrackingResult {
  const orderDate = formatOrderDate(order.createdAt);
  const orderNumber = formatOrderNumberLabel(order);
  const message = [
    "Your order has been fulfilled, but no tracking information has been provided by the shipping carrier yet.",
    "",
    `**Order Number:** ${orderNumber}`,
    `**Fulfillment Status:** ${order.displayFulfillmentStatus ?? "FULFILLED"}`,
    `**Order Date:** ${orderDate ?? "Unknown"}`,
  ].join("\n");

  return {
    success: true,
    status: "fulfilled_no_tracking",
    message,
    order: {
      name: order.name,
      number: order.number,
      financialStatus: order.displayFinancialStatus,
      fulfillmentStatus: order.displayFulfillmentStatus,
      orderDate,
    },
  };
}

function buildPartiallyFulfilled(order: ShopifyOrderRecord): OrderTrackingResult {
  const shipments = mapShipments(order.fulfillments);
  const orderNumber = formatOrderNumberLabel(order);
  const lines: string[] = [
    "Your order is partially shipped. Here are the shipments so far:",
    "",
    `**Order Number:** ${orderNumber}`,
    `**Fulfillment Status:** ${order.displayFulfillmentStatus ?? "PARTIALLY_FULFILLED"}`,
    "",
  ];

  if (shipments.length === 0) {
    lines.push("No fulfillment records are available yet.");
  } else {
    shipments.forEach((s, index) => {
      const trackHere =
        s.trackingUrl != null && s.trackingUrl.length > 0
          ? `[${s.trackingUrl}](${s.trackingUrl})`
          : "Not provided";
      lines.push(`**Shipment ${index + 1}**`);
      lines.push(`- **Carrier:** ${s.carrier ?? "Not provided"}`);
      lines.push(`- **Tracking Number:** ${s.trackingNumber ?? "Not provided"}`);
      lines.push(`- **Track Here:** ${trackHere}`);
      lines.push(`- **Fulfillment Status:** ${s.fulfillmentStatus ?? "Unknown"}`);
      lines.push("");
    });
  }

  return {
    success: true,
    status: "partially_fulfilled",
    message: lines.join("\n").trim(),
    order: {
      name: order.name,
      number: order.number,
      financialStatus: order.displayFinancialStatus,
      fulfillmentStatus: order.displayFulfillmentStatus,
      orderDate: formatOrderDate(order.createdAt),
      shipments,
    },
  };
}

function buildOtherStatus(order: ShopifyOrderRecord): OrderTrackingResult {
  const orderDate = formatOrderDate(order.createdAt);
  const orderNumber = formatOrderNumberLabel(order);
  const message = [
    "Here is the latest status for your order.",
    "",
    `**Order Number:** ${orderNumber}`,
    `**Financial Status:** ${order.displayFinancialStatus ?? "Unknown"}`,
    `**Fulfillment Status:** ${order.displayFulfillmentStatus ?? "Unknown"}`,
    `**Order Date:** ${orderDate ?? "Unknown"}`,
  ].join("\n");

  return {
    success: true,
    status: "other",
    message,
    order: {
      name: order.name,
      number: order.number,
      financialStatus: order.displayFinancialStatus,
      fulfillmentStatus: order.displayFulfillmentStatus,
      orderDate,
    },
  };
}

/** Map a Shopify order into one of the business-case responses. */
export function buildOrderTrackingResult(order: ShopifyOrderRecord): OrderTrackingResult {
  const fulfillment = (order.displayFulfillmentStatus ?? "").toUpperCase();

  if (fulfillment === "UNFULFILLED") {
    return buildUnfulfilled(order);
  }

  if (fulfillment === "PARTIALLY_FULFILLED") {
    return buildPartiallyFulfilled(order);
  }

  if (fulfillment === "FULFILLED") {
    if (hasAnyTracking(order.fulfillments)) {
      return buildFulfilledWithTracking(order);
    }
    return buildFulfilledNoTracking(order);
  }

  if (!fulfillment || order.fulfillments.length === 0) {
    return buildUnfulfilled(order);
  }

  if (hasAnyTracking(order.fulfillments)) {
    return buildFulfilledWithTracking(order);
  }

  return buildOtherStatus(order);
}

export interface TrackOrderOptions {
  region?: ShopifyStoreRegion;
  /** Required for public lookups — must match the order email. */
  email: string;
  signal?: AbortSignal;
}

/**
 * End-to-end: validate → Shopify lookup → email ownership check → case-based response.
 */
export async function trackOrder(
  rawOrderNumber: string,
  options: TrackOrderOptions
): Promise<OrderTrackingResult> {
  const normalized = normalizeOrderNumber(rawOrderNumber);
  if (!normalized) {
    return {
      success: false,
      status: "not_found",
      message: "Please provide a valid order number (for example 1001, #1001, or OT-cbn4m39wmd).",
      errorCode: "invalid_order_number",
    };
  }

  const email = normalizeEmail(options.email);
  if (!email) {
    return {
      success: false,
      status: "not_found",
      message: "Please provide the email address used when placing the order.",
      errorCode: "invalid_email",
    };
  }

  try {
    const order = await findOrderByNumber(normalized, {
      region: options.region,
      signal: options.signal,
    });

    // Identical response for missing order and email mismatch (no oracle).
    if (!order || !emailsMatch(order.email, email)) {
      return {
        success: false,
        status: "not_found",
        message: NOT_FOUND_MESSAGE,
      };
    }

    return buildOrderTrackingResult(order);
  } catch (err) {
    if (isConfigError(err)) {
      throw new OrderTrackingError(
        "Order tracking is not fully configured yet.",
        503,
        "config_error"
      );
    }
    if (err instanceof Error && /aborted|timeout|network|fetch/i.test(err.message)) {
      throw new OrderTrackingError(
        "We couldn't reach the order service right now. Please try again shortly.",
        502,
        "network_error"
      );
    }
    console.error("[order-tracking] Shopify lookup failed:", err);
    throw new OrderTrackingError(
      "We couldn't look up that order right now. Please try again shortly.",
      502,
      "shopify_error"
    );
  }
}

/** Plain chat reply text from a structured tracking result. */
export function formatOrderTrackingChatReply(result: OrderTrackingResult): string {
  return result.message;
}
