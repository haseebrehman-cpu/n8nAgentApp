/**
 * Product Shortlist Renderer — server-authored deterministic product cards.
 * The LLM may wrap this text conversationally but must not invent products.
 */

import type { ShownProduct } from "@/lib/chat/context/product-memory";

/** Customer-facing products shown initially. */
export const SHORTLIST_DISPLAY_LIMIT = 5;

export interface ShortlistRenderOptions {
  totalCount: number;
  products: ShownProduct[];
  /** Optional one-line benefits keyed by product id. */
  benefits?: Record<string, string>;
  heading?: string;
  showCount?: boolean;
  offerMore?: boolean;
  limit?: number;
}

function stockLabel(inStock: boolean | null): string {
  if (inStock === true) return "In stock";
  if (inStock === false) return "Out of stock";
  return "Availability varies";
}

function defaultBenefit(product: ShownProduct): string {
  if (product.onSale && product.wasPrice) {
    return `On sale — was ${product.wasPrice}`;
  }
  if (product.inStock === true) return "Ready to ship";
  return "Popular pick from our range";
}

export function formatProductCard(
  product: ShownProduct,
  benefit?: string,
): string {
  const price = product.price ?? "See price on product page";
  const was =
    product.wasPrice && product.onSale ? ` (was ${product.wasPrice})` : "";
  const why = benefit?.trim() || defaultBenefit(product);
  const url = product.url?.trim();
  const link = url ? `[View product](${url})` : "";

  return [
    `**${product.title}**`,
    `- Price: ${price}${was}`,
    `- Stock: ${stockLabel(product.inStock)}`,
    `- ${why}`,
    link ? `- ${link}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Render a deterministic shortlist: total (optional), up to N cards, offer more.
 */
export function renderProductShortlist(options: ShortlistRenderOptions): string {
  const limit = options.limit ?? SHORTLIST_DISPLAY_LIMIT;
  const slice = options.products.slice(0, limit);
  const total = options.totalCount;
  const showCount = options.showCount !== false;
  const offerMore = options.offerMore !== false && total > slice.length;

  const parts: string[] = [];
  if (options.heading?.trim()) {
    parts.push(`### ${options.heading.trim()}`);
    parts.push("");
  }

  if (showCount) {
    if (total === 0) {
      parts.push("I couldn't find matching products for that right now.");
    } else if (total === 1) {
      parts.push("I found **1** product that fits:");
    } else {
      parts.push(`I found **${total}** products that fit:`);
    }
    parts.push("");
  }

  for (const product of slice) {
    const benefit = options.benefits?.[product.id];
    parts.push(formatProductCard(product, benefit));
    parts.push("");
  }

  if (offerMore && total > slice.length) {
    parts.push(
      `There are **${total - slice.length}** more. Want me to show the next ones?`,
    );
  }

  return parts.join("\n").trim();
}

/** System instruction telling the model to wrap, not rewrite, the shortlist. */
export function shortlistWrapInstruction(shortlistMarkdown: string): string {
  return `PRODUCT SHORTLIST (server-authored — trusted product facts):
The following product list is complete and authoritative for this turn.
- Wrap it in a brief, warm, natural sales reply (1–2 short sentences before and/or after).
- Do NOT reorder, drop, invent, or add products.
- Do NOT change prices, stock, or URLs.
- Do NOT mention tools, APIs, MCP, search, or internal systems.
- At most ONE soft follow-up question at the end.

---
${shortlistMarkdown}
---`;
}
