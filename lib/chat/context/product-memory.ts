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
  inStock: boolean;
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
    inStock: raw.inStock === true,
    onSale: raw.onSale === true,
  };
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

/**
 * Build a trusted system message describing the recently shown products so the
 * model can resolve pronouns/follow-ups. Returns null when there is nothing to
 * remember. This is store-authored context, not untrusted catalog data.
 */
export function buildContextBlock(
  products: ShownProduct[] | null | undefined,
): string | null {
  if (!products || products.length === 0) return null;

  const lines = products.map((p, i) => {
    const price = p.price ? ` — ${p.price}` : "";
    const wasPrice = p.wasPrice ? ` (was ${p.wasPrice})` : "";
    const stock = p.inStock ? " — In stock" : " — Out of stock";
    const sale = p.onSale ? " — On sale" : "";
    return `${i + 1}. ${p.title}${price}${wasPrice}${stock}${sale} (id: ${p.id})`;
  });

  return `CONVERSATION CONTEXT (trusted — for resolving ALL customer follow-ups; do not repeat verbatim or expose ids to the customer):
These are the products you most recently showed the customer.

GENERAL CONTEXT RESOLUTION (CRITICAL):
- Use THIS context and conversation history to answer ANY follow-up, comparative, selection, or filtering question about these products (e.g., price, lowest/highest price, discounts, stock, size/weight, model, features, materials, use-case, suitability, or comparisons like "which of them...", "compare the first two", "are any for kids?", "which is lightest?").
- DO NOT call search_catalog for questions about products already in this list or conversation history. Answer directly using the details provided in context and previous turns.
- ACCURACY FOR PRICING & DISCOUNTS:
  * Prices: Read all product prices carefully before stating which has the lowest or highest price.
  * Discounts: A product is on sale/discounted ONLY if it has an explicit "was-price" or "On sale" tag. If none of the listed products are on sale, state clearly that none are currently discounted. Never confuse the lowest price item with a discounted item.
- FOR SPECIFIC VARIANT / SPEC DETAILS: If the user asks for deeper specifications or color/size options not listed in context, call get_product or lookup_catalog with the product's id.
- FOR EXACT INVENTORY UNITS: Call get_inventory with the product's id.
- FOR SIZE CHARTS: Call get_size_chart with the product's id.

Product List:
${lines.join("\n")}`;
}
