/**
 * Conversation Context Manager: structured memory of the products most recently
 * shown to the customer. This lets the advisor resolve follow-up references
 * ("these in red", "which is the cheapest?", "compare the two") without
 * re-searching, and lets it look up the right product/variant by id.
 *
 * Products are extracted from the compacted CATALOG_DATA tool results (see
 * `compactCatalogMcpText`) and stored on the session; a compact CONTEXT block is
 * injected back into the model conversation on the following turns.
 */

import { extractCatalogData } from "@/lib/chat/agent/mcp-format";

/** Minimal product footprint kept in session memory for follow-up resolution. */
export interface ShownProduct {
  id: string;
  title: string;
  price: string | null;
  wasPrice: string | null;
  url: string | null;
  /** null when catalog omitted availability — do not claim OOS. */
  inStock: boolean | null;
  onSale: boolean;
}

/** Cap so list-mode (up to 20) follow-ups still resolve pronouns. */
export const MAX_SHOWN_PRODUCTS = 20;

interface CatalogProductShape {
  id?: unknown;
  title?: unknown;
  price?: unknown;
  wasPrice?: unknown;
  url?: unknown;
  inStock?: unknown;
  onSale?: unknown;
}

function toShownProduct(raw: CatalogProductShape): ShownProduct | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!id || !title) return null;
  return {
    id,
    title,
    price: typeof raw.price === "string" && raw.price.trim() ? raw.price : null,
    wasPrice:
      typeof raw.wasPrice === "string" && raw.wasPrice.trim()
        ? raw.wasPrice
        : null,
    url: typeof raw.url === "string" && raw.url.trim() ? raw.url.trim() : null,
    inStock:
      typeof raw.inStock === "boolean" ? raw.inStock : null,
    onSale: raw.onSale === true,
  };
}

/** Sanitize persisted / wire product memory (Redis, Mongo, or API). */
export function normalizeShownProducts(raw: unknown): ShownProduct[] | null {
  if (!Array.isArray(raw)) return null;
  const shown: ShownProduct[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const product = toShownProduct(item as CatalogProductShape);
    if (product) shown.push(product);
    if (shown.length >= MAX_SHOWN_PRODUCTS) break;
  }
  return shown.length > 0 ? shown : null;
}

/**
 * Pull the products a catalog tool result surfaced to the customer. Accepts a
 * wrapped tool result (CATALOG_DATA + hint) or the raw compacted JSON. Handles
 * both search (`products[]`) and single-product (`product`) shapes.
 */
export function extractShownProducts(toolResult: string): ShownProduct[] {
  if (!toolResult) return [];
  const json = extractCatalogData(toolResult) || toolResult;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];

  const obj = parsed as { products?: unknown; product?: unknown };
  const list: CatalogProductShape[] = Array.isArray(obj.products)
    ? (obj.products as CatalogProductShape[])
    : obj.product && typeof obj.product === "object"
      ? [obj.product as CatalogProductShape]
      : [];

  const shown: ShownProduct[] = [];
  for (const raw of list) {
    const product = toShownProduct(raw);
    if (product) shown.push(product);
    if (shown.length >= MAX_SHOWN_PRODUCTS) break;
  }
  return shown;
}

export interface ContextBlockOptions {
  lastSearchQuery?: string | null;
  /** Active category / topic (e.g. "boxing gloves") for topic continuity. */
  pendingCategory?: string | null;
}

/**
 * Build a trusted system message describing the recently shown products so the
 * model can resolve pronouns/follow-ups. Returns null when there is nothing to
 * remember. This is store-authored context, not untrusted catalog data.
 */
export function buildContextBlock(
  products: ShownProduct[] | null | undefined,
  lastSearchQueryOrOptions?: string | null | ContextBlockOptions,
): string | null {
  if (!products || products.length === 0) return null;

  const options: ContextBlockOptions =
    typeof lastSearchQueryOrOptions === "string" ||
    lastSearchQueryOrOptions == null
      ? { lastSearchQuery: lastSearchQueryOrOptions }
      : lastSearchQueryOrOptions;

  const lines = products.map((p, i) => {
    const price = p.price ? ` — ${p.price}` : "";
    const wasPrice = p.wasPrice ? ` (was ${p.wasPrice})` : "";
    const stock =
      typeof p.inStock === "boolean"
        ? p.inStock
          ? " — In stock"
          : " — Out of stock"
        : "";
    const sale = p.onSale ? " — On sale" : "";
    return `${i + 1}. ${p.title}${price}${wasPrice}${stock}${sale} (id: ${p.id})`;
  });

  const lastQueryLine = options.lastSearchQuery?.trim()
    ? `\nLast catalog search query: "${options.lastSearchQuery.trim()}"\n`
    : "";
  const topicLine = options.pendingCategory?.trim()
    ? `Active topic / category: "${options.pendingCategory.trim()}"\n`
    : "";

  return `CONVERSATION CONTEXT (trusted — for resolving ALL customer follow-ups; do not repeat verbatim or expose ids to the customer):
These are the products you most recently showed the customer.
${topicLine}${lastQueryLine}
FOLLOW-UP RULES (CRITICAL):
- Answer compare / cheaper / colour / size / "which one" questions from THIS list first.
- "show cheaper ones" → pick the lower-priced items from this list (do not restart a new unrelated search).
- "only blue" / "16 oz" / "leather" → filter this list or merge with Last catalog search query.
- "back to the F4" / "the gloves from earlier" → resolve from this list + chat history.
- New unrelated topics ("actually show shin guards") → new search_catalog; keep this memory for later.
- DO NOT call search_catalog for pure rank/compare/filter of products already listed — answer from context.
- Format with response templates: ### headings, hyphen bullets, max 2 sentences per paragraph. No tables. No ids in customer text.
- Pricing: read prices carefully. On sale ONLY with was-price / On sale tag.
- Deeper variants/specs → get_product with id. Exact units → get_inventory. Size chart → get_size_chart.
- After helping, at most ONE soft cross-sell (e.g. wraps with gloves) from real catalog data.

Product List:
${lines.join("\n")}`;
}
