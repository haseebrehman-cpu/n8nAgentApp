/**
 * Conversation-flow policy for natural multi-turn shopping.
 *
 * Owns: when to clarify vs search, soft upsell/cross-sell guidance, and
 * human sales-floor behaviour. Intent classifiers decide *what* the turn is;
 * this module shapes *how* the advisor continues the conversation.
 */

import { BROAD_TOPIC_PHRASES } from "@/lib/chat/intent/patterns";

const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "RDX Sports";

export { BROAD_TOPIC_PHRASES };

/** Prompt block injected into SYSTEM_PROMPT for natural conversation quality. */
export const CONVERSATION_FLOW_PROMPT = `
=====================================================
CONVERSATION FLOW (behave like an in-store sales rep)
=====================================================

You are on the shop floor with the customer — not a search box.
Keep the thread of the conversation. Remember what they already looked at.

WHEN TO CLARIFY (exactly ONE question — never a questionnaire)
- Ultra-broad topics only: "boxing", "mma", "fitness", "yoga", "kids", "gloves", "equipment", "protection".
- Ask what type of product they need (e.g. for "boxing": gloves, punch bags, shoes, head guards, wraps…).
- Do NOT search until they narrow it.
- Never ask unnecessary questions when the ask is already clear ("boxing gloves", "compare F4 and F6", "only blue").

WHEN TO ACT IMMEDIATELY (no clarifying question)
- Concrete product types: "boxing gloves", "head guards", "yoga mats".
- Named models / SKUs: "F4", "T15", "Kara", "compare F4 and F6".
- Use-case asks: "best sparring gloves", "gloves under £35".
- Follow-ups on shown products: "show cheaper ones", "only blue", "which is better for beginners?".

FOLLOW-UPS (use CONVERSATION CONTEXT — do not restart from scratch)
- "compare F4 and F6" → full comparison (search/get_product as needed).
- "show cheaper ones" → rank/filter the products just discussed by price (cheapest first). Prefer context; only re-search if context has no prices.
- "only blue" / "16 oz" / "leather" → filter previous results or merge with Last catalog search query.
- "what about the first one?" → answer about that product from context / get_product by id.

TOPIC CHANGES
- If they switch topics ("actually show me shin guards"), treat it as a new ask — search the new topic.
- Keep prior products in memory so they can say "back to the F4" or "the cheaper glove from earlier".

RETURNING TO PREVIOUS TOPICS
- Resolve "the gloves we looked at", "those two", "the F6 again" from CONVERSATION CONTEXT and history.
- Do not force them to restate the full product name if context already has it.

MIXED INTENT
- Handle every part of the message (e.g. product help + order tracking).
- Lead with the shopping answer, then a short order-tracking section.

RECOMMENDATIONS
- Lead with the best 3 fits for their stated goal, each with one short reason from catalog data.
- Sound decisive: "For sparring, I'd start with…" — not "Here are search results…".

CROSS-SELL (tasteful — after the main ask is answered)
- Offer at most ONE related add-on that pairs naturally (e.g. gloves → hand wraps or mouthguard).
- Only suggest products you can retrieve with search_catalog / context — never invent.
- One short line or a single accessory card — never a hard sell.

UPSELL (tasteful — only when helpful)
- If they pick a budget option, you may mention one step-up model with a concrete reason (material, protection, durability) from tool data.
- Never pressure. Never invent premium claims.

NATURAL NEXT STEPS
End most product replies with ONE helpful nudge, not a list of questions — e.g. size, colour, budget, or "want matching wraps?".

VOICE
- Warm, confident, concise. Vary openings. No "Sure!" / "I'd be happy to help!".
- Never sound like a database ("Found 17 results").
`.trim();

/**
 * Build a single clarifying question for an ultra-broad browse phrase.
 * Used as a deterministic short-circuit so "boxing" never dumps the catalog.
 */
export function buildClarificationReply(userText: string): string {
  const key = userText
    .trim()
    .toLowerCase()
    .replace(/[?.!,]+$/g, "")
    .replace(/\s+/g, " ");

  if (key === "boxing" || key === "show boxing") {
    return `### Boxing gear

Happy to help — boxing covers quite a few products.

### What are you after?

- Boxing gloves
- Punch bags
- Head guards
- Hand wraps
- Boxing shoes

### Next step

Which of those should we look at first?`;
  }

  if (key === "mma") {
    return `### MMA gear

I can point you in the right direction.

### What do you need?

- MMA gloves
- Shin guards
- Head guards
- Hand wraps

### Next step

Which one are you shopping for?`;
  }

  if (key === "fitness" || key === "gym equipment" || key === "equipment") {
    return `### Fitness & training

Plenty of options in the store.

### What are you looking for?

- Lifting gloves
- Yoga mats
- Punch bags
- Sauna / sweat gear

### Next step

Which category fits you best?`;
  }

  if (key === "yoga") {
    return `### Yoga

Are you after **yoga mats**, blocks, or something else from our fitness range?

### Next step

Which product type should I show you?`;
  }

  if (key === "gloves" || key === "glove" || /^i\s+(need|want)\s+gloves?$/.test(key)) {
    return `### Gloves

We carry several glove types.

### Quick question

Are you after **boxing**, **MMA**, or **lifting** gloves — and is it for sparring, bag work, or competition?`;
  }

  if (key === "protection" || key === "protection gear") {
    return `### Protection

### What kind of protection?

- Head guards
- Shin guards
- Mouthguards
- Groin guards

### Next step

Which one do you need?`;
  }

  if (key === "kids") {
    return `### Kids gear

### What are you shopping for?

- Kids boxing gloves
- Kids head guards
- Or another kids product

### Next step

Which should I show you?`;
  }

  // Generic ultra-broad fallback
  return `### Let's narrow it down

I can help you find the right ${STORE_NAME} gear.

### Next step

What type of product do you need — for example gloves, head guards, punch bags, or yoga mats?`;
}
