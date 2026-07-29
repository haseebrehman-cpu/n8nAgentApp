/**
 * Deterministic customer replies for ecommerce journeys that should not
 * depend on the LLM (social openers, post-purchase limits, contact).
 */

import { STORE_NAME } from "@/lib/chat/messaging/replies";

export const GREETING_REPLY = `### Welcome to ${STORE_NAME}

How can I help you today?

### Popular starting points

- Boxing or MMA gloves
- Head guards and protection
- Punch bags and fitness gear
- Track an order

### Next step

Tell me what you're looking for — or the sport you train.`;

export const THANKS_REPLY = `### You're welcome

Glad I could help.

### Next step

If you need sizes, stock, or something else from the range, just ask.`;

export const GOODBYE_REPLY = `### Take care

Thanks for chatting with ${STORE_NAME}.

### Next step

Come back anytime if you need gear recommendations or order help.`;

export const ORDER_CANCEL_REPLY = `### Order cancellation

I can't cancel orders directly in chat — that needs our support team so we can check the order status safely.

### What to do

- Have your **order number** and **checkout email** ready
- Ask to speak with a human, or contact support through the store

### Meanwhile

I can look up tracking status if you share the order number and email.`;

export const ORDER_MODIFY_REPLY = `### Changing an order

I can't modify orders (items, sizes, or quantities) in chat.

### What to do

- Contact support with your **order number** and **checkout email**
- Or ask me to connect you with a human agent

### Meanwhile

I can help you find the right replacement product or size for a new order.`;

export const ADDRESS_CHANGE_REPLY = `### Shipping address changes

I can't update shipping addresses in chat — that has to go through support for security.

### What to do

- Contact support with your **order number** and **checkout email**
- Or ask to speak with a human agent

### Meanwhile

I can check tracking once the order is on its way.`;

export const CONTACT_SUPPORT_REPLY = `### Contact ${STORE_NAME} support

I can help with products, policies, and order tracking here in chat.

### For account or order changes

- Ask to **speak with a human agent** and I'll escalate
- Or use the contact options on our store's help / contact page (via store policies)

### Handy to have ready

- Order number
- Checkout email

### Next step

Want product help now, or shall I connect you with the support team?`;
