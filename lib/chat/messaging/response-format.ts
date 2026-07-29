/**
 * Reusable customer-response formatting rules and helpers for GPT-5.6 Terra.
 *
 * The model writes the reply; this module defines the shared contract
 * (headings, spacing, bullets, omit-empty) and small builders used when
 * assembling structured sections server-side. Keep all sales-facing format
 * decisions here so prompts, polish, and canned replies stay consistent.
 */

/** Max sentences allowed in a single paragraph. */
export const MAX_SENTENCES_PER_PARAGRAPH = 2;

/** Shared formatting contract injected into the system prompt. */
export const RESPONSE_FORMAT_RULES = `
=====================================================
RESPONSE FORMAT (MANDATORY — every customer reply)
=====================================================
Write like an experienced ecommerce sales assistant: warm, clear, decisive.
Customers must be able to scan your reply in seconds.

STRUCTURE
- Start with a short introduction (1–2 sentences max).
- Use clear markdown headings (### Heading) for each major section.
- Put a blank line between paragraphs and before/after headings.
- Use hyphen bullet lists (- ) for options, features, and product facts.
- Keep paragraphs to a maximum of ${MAX_SENTENCES_PER_PARAGRAPH} sentences.
- Prefer short sentences. No walls of text.

PRODUCT CARDS
When showing one or more products, use this card shape (omit any line with no data):

### **{Product Name}**

- **Price:** {price} (was {wasPrice} — only if on sale)
- **Stock:** In stock | Out of stock
- **Why it fits:** {one short reason from catalog data — search/recommend only}
- [View product]({url})

Never repeat the same product name in the intro and again as a redundant subtitle.
Never list the same product twice.

NEVER OUTPUT
- Markdown tables (no | columns |). Use headings + bullets instead.
- Raw JSON, code fences with catalog payloads, or tool dumps.
- Database / API field names (productCount, inStock, wasPrice, gid://, relevanceScore, CATALOG_DATA, etc.).
- Empty sections ("Materials: —", "Colours: N/A", "Features: none").
- Duplicated information or repeated product names.

OMIT EMPTY ATTRIBUTES
If a fact is missing from tool data, skip that bullet/section entirely.
Do not invent placeholders. Do not say "not available" for every missing field —
only mention a gap when the customer specifically asked about that attribute.

TONE
- Natural, professional, helpful — not robotic.
- Do not start with "Sure", "Certainly", or "I'd be happy to help".
- Bold product names and field labels only (**Price:**, **Stock:**).
- Use hyphen bullets (- ), never •.
- Quote currency exactly as tools return it. Never convert or round.
- Only share product links from tool url values as [View product](url).
- Never paste image/CDN URLs.
`.trim();

/** Optional labelled section — returns "" when value is empty. */
export function formatSection(
  heading: string,
  body: string | null | undefined,
): string {
  const text = (body ?? "").trim();
  if (!text) return "";
  return `### ${heading}\n\n${text}`;
}

/** Bullet list from values; drops empties. */
export function formatBulletList(
  items: Array<string | null | undefined>,
): string {
  const lines = items
    .map((item) => (item ?? "").trim())
    .filter(Boolean)
    .map((item) => (item.startsWith("- ") ? item : `- ${item}`));
  return lines.join("\n");
}

/** Labelled bullet; omitted when value is empty. */
export function formatFact(
  label: string,
  value: string | null | undefined,
): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return `- **${label}:** ${v}`;
}

/**
 * Join sections with blank lines, dropping empties.
 * Use for composing multi-section replies without empty headings.
 */
export function joinSections(sections: Array<string | null | undefined>): string {
  return sections
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Build a product card markdown block. Omits lines with no data.
 */
export function formatProductCard(input: {
  name: string;
  price?: string | null;
  wasPrice?: string | null;
  inStock?: boolean | null;
  reason?: string | null;
  url?: string | null;
}): string {
  const name = input.name.trim();
  if (!name) return "";

  const priceLine =
    input.price?.trim() &&
    (input.wasPrice?.trim()
      ? `- **Price:** ${input.price.trim()} (was ${input.wasPrice.trim()})`
      : `- **Price:** ${input.price.trim()}`);

  const stockLine =
    typeof input.inStock === "boolean"
      ? `- **Stock:** ${input.inStock ? "In stock" : "Out of stock"}`
      : null;

  const reasonLine = formatFact("Why it fits", input.reason);
  const linkLine =
    input.url?.trim() ? `- [View product](${input.url.trim()})` : null;

  return joinSections([
    `### **${name}**`,
    formatBulletList([priceLine || null, stockLine, reasonLine, linkLine]),
  ]);
}
