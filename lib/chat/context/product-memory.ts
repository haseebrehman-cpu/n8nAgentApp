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
    url: typeof raw.url === "string" && raw.url.trim() ? raw.url : null,
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
    const stock = p.inStock ? " — In stock" : " — Out of stock";
    const sale = p.onSale ? " — On sale" : "";
    return `${i + 1}. ${p.title}${price}${stock}${sale} (id: ${p.id})`;
  });

  return `CONVERSATION CONTEXT (trusted — for resolving the customer's follow-ups; do not repeat verbatim or expose ids to the customer):
These are the products you most recently showed the customer. Resolve references like "these", "those", "this", "that", "it", "them", "the ones", "which one", "the cheapest", or "compare the two" to THIS list. For variant questions ("in red?", "in XL?") or details on one of these, call get_product/lookup_catalog with the matching id before searching again. For exact unit / inventory questions ("how many are available?", "how many left?"), call get_inventory with the matching id. For size-chart / size-guide requests about one of these, call get_size_chart with the matching id.
${lines.join("\n")}`;
}
