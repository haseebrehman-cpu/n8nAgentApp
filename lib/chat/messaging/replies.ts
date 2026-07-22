/**
 * Customer-facing canned replies used by the agent for deterministic responses
 * (safety refusals, off-topic redirects, order-tracking prompts, fallbacks).
 * Centralised so copy lives in one place and is easy to review and localise.
 */

export const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "our store";

export const FALLBACK_REPLY =
  "I'm sorry, I couldn't complete that request. Could you rephrase it or try again?";

export const NOT_AVAILABLE_REPLY =
  "I'd be happy to help you find the right product. Could you tell me a bit more about what you're looking for — for example a category, size, or product name?";

export const DISCOUNT_CODE_REPLY =
  "We don't share discount or coupon codes in chat. If you'd like, I can show you products that are currently on sale at a reduced price instead.";

export const OFF_TOPIC_REPLY = `I'm here to help with ${STORE_NAME} products and shopping-related questions. If you're looking for equipment, product information, pricing, sizes, stock, or recommendations, I'd be happy to help.`;

/**
 * Firm, safe reply for dangerous, illegal, or clearly harmful requests. "RDX"
 * is our brand name but is also a military explosive, so shoppers sometimes
 * pair it with bombs/weapons/etc. — never engage, always redirect to shopping.
 */
export const HARMFUL_QUERY_REPLY = `I can't help with that. I'm here to help you shop with ${STORE_NAME} — our products, store policies, and order tracking. Is there something I can help you find today?`;

export const ASK_ORDER_NUMBER_REPLY =
  "Sure — I can help track that. What's your order number?";

export const ASK_ORDER_EMAIL_REPLY =
  "Thanks. What's the email address you used when you placed the order?";

export const ASK_ORDER_NUMBER_CLARIFY_REPLY =
  "Happy to help track that. Please share your order number (for example 1001, #1001, or OT-cbn4m39wmd).";

export const ORDER_EMAIL_STILL_NEEDED_REPLY =
  "I still need the email address you used when placing the order — for example name@email.com.";

export const ORDER_TRACKING_UNAVAILABLE_REPLY =
  "Order tracking is temporarily unavailable. Please try again later.";

export const ORDER_LOOKUP_FAILED_REPLY =
  "We couldn't look up that order right now. Please try again shortly.";

export const CONTENT_FILTERED_REPLY =
  "I couldn't complete that reply. Please try rephrasing your question.";

/**
 * Reply when the customer explicitly asks for a human. Escalate immediately
 * rather than looping them through the assistant.
 */
export const HUMAN_ESCALATION_REPLY = `Of course — I'll connect you with our ${STORE_NAME} support team. They'll follow up as soon as they can. In the meantime, if you have an order number and the email used at checkout handy, it'll help them assist you faster. Is there anything I can look into for you while you wait?`;
