import { describe, expect, it } from "vitest";
import {
  formatProductCard,
  renderProductShortlist,
  SHORTLIST_DISPLAY_LIMIT,
} from "@/lib/chat/response/shortlist";
import { polishCustomerReply } from "@/lib/chat/messaging/polish";

const products = Array.from({ length: 8 }, (_, i) => ({
  id: `gid://shopify/Product/${i + 1}`,
  title: `Product ${String.fromCharCode(65 + i)}`,
  price: `£${20 + i}.00`,
  wasPrice: null,
  url: `https://example.com/products/p-${i + 1}`,
  inStock: true,
  onSale: false,
}));

describe("product shortlist renderer", () => {
  it("shows at most 5 products and reports total", () => {
    const md = renderProductShortlist({
      totalCount: 8,
      products,
    });
    expect(SHORTLIST_DISPLAY_LIMIT).toBe(5);
    expect(md).toContain("**8**");
    expect(md).toContain("Product A");
    expect(md).toContain("Product E");
    expect(md).not.toContain("Product F");
    expect(md).toMatch(/more/i);
  });

  it("formats a complete product card", () => {
    const card = formatProductCard(products[0]!);
    expect(card).toContain("Product A");
    expect(card).toContain("£20.00");
    expect(card).toContain("In stock");
    expect(card).toContain("View product");
  });

  it("polish does not leave MCP/API leakage phrases", () => {
    const dirty =
      "I searched the MCP API and the tool returned 3 products from GraphQL.";
    const cleaned = polishCustomerReply(dirty);
    expect(cleaned.toLowerCase()).not.toMatch(/\bmcp\b/);
    expect(cleaned.toLowerCase()).not.toMatch(/\bgraphql\b/);
  });
});
