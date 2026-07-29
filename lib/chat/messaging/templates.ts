/**
 * Reusable reply templates for GPT-5.6 Terra.
 *
 * These are prompt contracts the model must follow — not rendered HTML.
 * Missing attributes are omitted (never shown as empty). Keep templates
 * aligned with RESPONSE_FORMAT_RULES in response-format.ts.
 */

import { RESPONSE_FORMAT_RULES } from "@/lib/chat/messaging/response-format";

const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "RDX Sports";

/** Product search / shortlist results. */
export const TEMPLATE_PRODUCT_SEARCH = `
### Template: Product search

Introduction
{1–2 sentences: what you found for their intent — no tool jargon}

### Matching products

{3–5 Product Cards — highest relevance first; omit duplicates}

### Next step

{1 short sentence: narrow by size/colour/budget, OR one soft accessory cross-sell if natural}
`.trim();

/** Full product details (get_product). */
export const TEMPLATE_PRODUCT_DETAILS = `
### Template: Product details

Introduction
{1–2 sentences naming the product and who/what it suits — from catalog data only}

### Overview
{1–2 short sentences from summary/title — no fluff}

### Price
{current price; include was-price only if on sale}

### Features
{bullets from catalog summary/features — omit if none}

### Materials
{only if stated in tool data}

### Sizes
{available sizes/weights with stock notes — omit if none}

### Colours
{available colours with stock notes — omit if none}

### Availability
{In stock / Out of stock — from tool flags}

### Product
{single Product Card with link}
`.trim();

/**
 * Comparisons — section order is fixed. Omit any section with no data
 * for either product; do not print empty headings.
 */
export const TEMPLATE_COMPARISON = `
### Template: Comparison (ALWAYS this order)

Introduction
{1–2 sentences naming both products and the goal of the comparison}

### Best For
{bullet per product: ideal use / skill level — only from tool data}

### Price
{bullet per product with current price; was-price only if on sale}

### Features
{key differences as bullets — omit if nothing reliable}

### Materials
{only if present in tool data}

### Protection
{padding / protection differences — only if present}

### Comfort
{only if present in tool data}

### Sizes
{weight/size options — only if present}

### Colours
{only if present}

### Availability
{stock for each — from tool flags}

### Discount
{only if either product is on sale; otherwise OMIT this entire section}

### Recommendation
{1–2 sentences: which to pick for which customer — honest, from data}

### Product Cards
{one Product Card per compared product — names once only}
`.trim();

/** Category browse / "how many in category". */
export const TEMPLATE_CATEGORY_LISTING = `
### Template: Category listing

Introduction
{We have **X** products in **{category}**. Show a sample below.}

### Popular picks

{up to 5 Product Cards from the payload — never invent extras}

### Narrow it down

{1 short sentence: invite model, size, weight, material, or use — optional soft cross-sell}
`.trim();

/** Explicit "show all / list every" (cap from server payload). */
export const TEMPLATE_FULL_LIST = `
### Template: Full list

Introduction
{Total from productCount. If truncated, say you are showing the first N only.}

### Products

{Product Cards from the payload — name, price, stock, link only}

### Next step

{Offer to filter or continue with a specific model}
`.trim();

/** Use-case recommendations. */
export const TEMPLATE_RECOMMENDATIONS = `
### Template: Recommendations

Introduction
{1–2 sentences confirming the use-case (e.g. sparring, bag work, beginners)}

### Top picks

{3–5 Product Cards, each with a one-line **Why it fits** from catalog data}

### How to choose

{1–2 short bullets or sentences: decision tips from real attributes}

### Next step

{Offer to filter by budget, size, or colour — or one tasteful upsell/cross-sell from real catalog data}
`.trim();

/** Accessories / "what else do I need" / kit add-ons. */
export const TEMPLATE_ACCESSORIES = `
### Template: Accessories

Introduction
{1–2 sentences: useful add-ons for the product/use-case in context}

### Recommended accessories

{Product Cards — wraps, mouthguard, bag, etc. only from search results}

### Next step

{Ask which accessory to look at first, or offer a starter kit if relevant}
`.trim();

/** Out of stock for a specific product / variant. */
export const TEMPLATE_OUT_OF_STOCK = `
### Template: Out of stock

Introduction
{Clearly say the requested product or variant is out of stock}

### Alternatives in stock

{Product Cards or in-stock variants of the same product — from tool data}

### Next step

{Offer notify-style next step: similar model, other size/colour, or browse category}
`.trim();

/** Empty / no useful search results. */
export const TEMPLATE_NO_RESULTS = `
### Template: No search results

Introduction
{Honest: nothing matched that ask in the ${STORE_NAME} catalog}

### What we can try

- Broaden the search (drop colour/budget)
- Nearby categories we do carry (boxing, MMA, fitness, yoga, etc.)
- Ask for model name, size, or use-case

### Next step

{ONE clarifying question — category, size, or product name}
`.trim();

/** Policy / FAQ answers from search_shop_policies_and_faqs. */
export const TEMPLATE_FAQ = `
### Template: FAQ / policy

Introduction
{1–2 sentences answering the question directly}

### Details

{Short bullets or short paragraphs from the policy tool only — max 2 sentences per paragraph}

### Next step

{Offer related help: tracking, product find, or human support if needed}
`.trim();

/** Inventory quantity answer. */
export const TEMPLATE_INVENTORY = `
### Template: Inventory

Introduction
{Answer the quantity question in 1–2 sentences from get_inventory only}

### Availability

- **Units available:** {N} — only if tracksInventory and N is known
- **Status:** In stock | Out of stock | Low stock (only N left) when 1–5 units

(Omit Units if quantity is not tracked; never invent a number.)
`.trim();

/** Merchandising collections (best sellers, new arrivals, trending, gifts, sale). */
export const TEMPLATE_MERCHANDISING = `
### Template: Merchandising

Introduction
{1–2 sentences naming the collection intent — best sellers / new arrivals / trending / gifts / sale}

### Picks

{3–5 Product Cards from search — on-sale journeys must only show sale items}

### Next step

{Offer to filter by sport, budget, or size}
`.trim();

/** Gift recommendations. */
export const TEMPLATE_GIFT = `
### Template: Gift

Introduction
{1–2 sentences confirming who/what the gift is for if known}

### Gift ideas

{3–5 Product Cards with a short why-it-works reason}

### Next step

{Ask budget or recipient preference only if still needed — one question max}
`.trim();

/**
 * Full prompt block: global format rules + all templates.
 * Appended to SYSTEM_PROMPT so Terra always has the same contract.
 */
export const RESPONSE_TEMPLATES_PROMPT = `
${RESPONSE_FORMAT_RULES}

=====================================================
RESPONSE TEMPLATES (pick the closest fit — omit empty sections)
=====================================================

${TEMPLATE_PRODUCT_SEARCH}

------------------------------------

${TEMPLATE_PRODUCT_DETAILS}

------------------------------------

${TEMPLATE_COMPARISON}

------------------------------------

${TEMPLATE_CATEGORY_LISTING}

------------------------------------

${TEMPLATE_FULL_LIST}

------------------------------------

${TEMPLATE_RECOMMENDATIONS}

------------------------------------

${TEMPLATE_ACCESSORIES}

------------------------------------

${TEMPLATE_OUT_OF_STOCK}

------------------------------------

${TEMPLATE_NO_RESULTS}

------------------------------------

${TEMPLATE_FAQ}

------------------------------------

${TEMPLATE_INVENTORY}

------------------------------------

${TEMPLATE_MERCHANDISING}

------------------------------------

${TEMPLATE_GIFT}

When a reply mixes intents (e.g. product + order tracking), use the product
template first, then a short ### Order tracking section — still no tables.
`.trim();
