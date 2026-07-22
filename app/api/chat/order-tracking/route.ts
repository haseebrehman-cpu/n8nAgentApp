import { NextRequest, NextResponse } from "next/server";
import {
  OrderTrackingError,
  trackOrder,
  type OrderTrackingResult,
} from "@/lib/chatbot/orderTracking";
import { getClientIp } from "@/lib/http/client-ip";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseShopifyRegion } from "@/services/shopify/credentials";

export const runtime = "nodejs";

const MAX_ORDER_NUMBER_CHARS = 64;
const MAX_EMAIL_CHARS = 254;

export async function POST(req: NextRequest) {
  const rate = await checkRateLimit(getClientIp(req), { bucket: "order" });
  if (!rate.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: rate.failClosed
          ? "Service temporarily unavailable. Please try again shortly."
          : "Too many requests. Please wait a moment and try again.",
      },
      {
        status: rate.failClosed ? 503 : 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      }
    );
  }

  let body: { orderNumber?: unknown; email?: unknown; region?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          'Request body must be JSON: { "orderNumber": "1001", "email": "you@example.com" }.',
      },
      { status: 400 }
    );
  }

  const orderNumber =
    typeof body.orderNumber === "string"
      ? body.orderNumber.slice(0, MAX_ORDER_NUMBER_CHARS)
      : "";
  const email =
    typeof body.email === "string" ? body.email.slice(0, MAX_EMAIL_CHARS) : "";

  if (!orderNumber.trim()) {
    return NextResponse.json(
      {
        success: false,
        status: "not_found",
        message:
          "Please provide a valid order number (for example 1001, #1001, or OT-cbn4m39wmd).",
        errorCode: "invalid_order_number",
      } satisfies OrderTrackingResult,
      { status: 400 }
    );
  }

  if (!email.trim()) {
    return NextResponse.json(
      {
        success: false,
        status: "not_found",
        message: "Please provide the email address used when placing the order.",
        errorCode: "email_required",
      } satisfies OrderTrackingResult,
      { status: 400 }
    );
  }

  try {
    const result = await trackOrder(orderNumber, {
      email,
      region: parseShopifyRegion(body.region),
      signal: req.signal,
    });

    if (
      result.errorCode === "invalid_order_number" ||
      result.errorCode === "invalid_email" ||
      result.errorCode === "email_required"
    ) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof OrderTrackingError) {
      logger.error("api/order-tracking", err.message, { code: err.code });
      return NextResponse.json(
        { success: false, error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    logger.error("api/order-tracking", "unexpected error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        success: false,
        error: "We couldn't look up that order right now. Please try again shortly.",
      },
      { status: 502 }
    );
  }
}
