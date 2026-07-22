/**
 * Order-tracking lookup used by the deterministic order-tracking conversation
 * flow (outside the LLM tool loop). Turns an order number + email into a
 * customer-facing reply, mapping tracking/config errors to safe messages.
 */

import { isConfigError } from "@/lib/config";
import { logger } from "@/lib/logger";
import {
  OrderTrackingError,
  formatOrderTrackingChatReply,
  trackOrder,
} from "@/lib/chatbot/orderTracking";
import type { ShopifyStoreRegion } from "@/services/shopify/credentials";
import {
  ORDER_LOOKUP_FAILED_REPLY,
  ORDER_TRACKING_UNAVAILABLE_REPLY,
} from "@/lib/chat/messaging/replies";

export async function lookupOrderReply(
  orderNumber: string,
  email: string,
  options: { region?: ShopifyStoreRegion; signal?: AbortSignal },
): Promise<string> {
  try {
    const result = await trackOrder(orderNumber, {
      email,
      region: options.region,
      signal: options.signal,
    });
    return formatOrderTrackingChatReply(result);
  } catch (err) {
    if (err instanceof OrderTrackingError) return err.message;
    if (isConfigError(err)) {
      return ORDER_TRACKING_UNAVAILABLE_REPLY;
    }
    logger.error("chat-agent", "track_order failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return ORDER_LOOKUP_FAILED_REPLY;
  }
}
