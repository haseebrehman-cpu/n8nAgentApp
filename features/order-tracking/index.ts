/** Feature barrel: order tracking. */
export {
  trackOrder,
  normalizeOrderNumber,
  normalizeEmail,
  isValidOrderNumberInput,
  isValidEmailInput,
  OrderTrackingError,
  formatOrderTrackingChatReply,
} from "@/lib/chatbot/orderTracking";
export { findOrderByNumber } from "@/services/shopify/orderTracking";
export { resolveShopifyStore } from "@/services/shopify/credentials";
