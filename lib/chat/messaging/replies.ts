/**
 * Customer-facing canned replies used by the agent for deterministic responses
 * (safety refusals, off-topic redirects, order-tracking prompts, fallbacks).
 * Formatted to match RESPONSE_FORMAT_RULES (headings, short paragraphs, bullets).
 */

export const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "our store";

export const FALLBACK_REPLY = `### Something went wrong

I couldn't complete that request just now.

### Next step

Could you rephrase it, or tell me the product or category you're looking for?`;

export const NOT_AVAILABLE_REPLY = `### Let's find the right product

I don't have a clear match for that yet.

### What helps me search

- A category or product type
- A model name
- Size, colour, budget, or use-case

### Next step

What are you shopping for today?`;

export const DISCOUNT_CODE_REPLY = `### Discount codes

We don't share discount or coupon codes in chat.

### What I can do

I can show products that are **currently on sale** at a reduced price.

### Next step

Would you like to see what's on sale right now?`;

export const OFF_TOPIC_REPLY = `### ${STORE_NAME} shopping help

I only help with ${STORE_NAME} products and shopping questions.

### I can help with

- Product information and recommendations
- Pricing, sizes, and stock
- Store policies and order tracking

### Next step

What gear are you looking for?`;

/**
 * Firm, safe reply for dangerous, illegal, or clearly harmful requests. "RDX"
 * is our brand name but is also a military explosive, so shoppers sometimes
 * pair it with bombs/weapons/etc. — never engage, always redirect to shopping.
 */
export const HARMFUL_QUERY_REPLY = `### I can't help with that

I'm here to help you shop with ${STORE_NAME} — our products, store policies, and order tracking.

### Next step

Is there equipment or a product I can help you find today?`;

export const ASK_ORDER_NUMBER_REPLY = `### Order tracking

I can look that up for you.

### Next step

What's your order number?`;

export const ASK_ORDER_EMAIL_REPLY = `### Almost there

I still need the email used at checkout.

### Next step

What email address did you use when placing the order?`;

export const ASK_ORDER_NUMBER_CLARIFY_REPLY = `### Order tracking

Please share your order number so I can look it up.

### Examples

- 1001
- #1001
- OT-cbn4m39wmd`;

export const ORDER_EMAIL_STILL_NEEDED_REPLY = `### Email still needed

I need the email address used when placing the order.

### Example

name@email.com`;

export const ORDER_TRACKING_UNAVAILABLE_REPLY = `### Order tracking unavailable

Order tracking isn't available in chat right now.

### Next step

Ask to **speak with a human agent**, or contact support with your order number and checkout email. Meanwhile I can still help with products and policies.`;

export const ORDER_LOOKUP_FAILED_REPLY = `### Lookup failed

We couldn't look up that order right now.

### Next step

Please try again shortly, or share the order number and checkout email again.`;

export const CONTENT_FILTERED_REPLY = `### Couldn't complete that reply

I couldn't finish that answer.

### Next step

Please try rephrasing your question.`;

/** Infra / timeout / MCP failure — never expose internal error details. */
export const SERVICE_UNAVAILABLE_REPLY = `### Temporarily unavailable

I'm having trouble reaching the product catalog right now.

### Next step

Please try again in a moment — or tell me the product name and I'll retry.`;

/** Soft redirect for clear jailbreak / prompt-injection attempts. */
export const INJECTION_REDIRECT_REPLY = `### ${STORE_NAME} shopping help

I can help with products, sizing, stock, policies, and order tracking.

### Next step

What are you looking for today?`;

/**
 * Reply when the customer explicitly asks for a human. Escalate immediately
 * rather than looping them through the assistant.
 */
export const HUMAN_ESCALATION_REPLY = `### Connecting you with support

I'll connect you with our ${STORE_NAME} support team. They'll follow up as soon as they can.

### Helpful to have ready

- Your order number
- The email used at checkout

### Meanwhile

Is there a product, size, or order detail I can look into for you while you wait?`;
