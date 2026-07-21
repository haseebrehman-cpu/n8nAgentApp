import { describe, expect, it } from "vitest";
import {
  compactCatalogMcpText,
  compactProduct,
  extractProductTerms,
  filterProductsByQueryRelevance,
  formatMoney,
} from "@/lib/shopify/compact-catalog";
import { normalizeSearchQuery } from "@/lib/chat-agent";

describe("formatMoney", () => {
  it("formats minor units with currency", () => {
    expect(formatMoney({ amount: 2999, currency: "GBP" })).toBe("£29.99");
    expect(formatMoney({ amount: 1099, currency: "GBP" })).toBe("£10.99");
  });
});

describe("extractProductTerms / filterProductsByQueryRelevance", () => {
  it("extracts terms from how-many questions for any category", () => {
    expect(extractProductTerms("how many products in sauna vests")).toEqual([
      "sauna",
      "vest",
    ]);
    expect(extractProductTerms("how many boxing gloves")).toEqual([
      "boxing",
      "glove",
    ]);
    expect(extractProductTerms("how many shin guards")).toEqual([
      "shin",
      "guard",
    ]);
  });

  it("keeps sweat vests and drops sauna suits/leggings", () => {
    const products = [
      { title: "RDX M1 Men Sweat Vest Without Zipper" },
      { title: "RDX W1 Women Sweat Vest Without Zipper" },
      { title: "RDX W2 Women Sweat Vest With Zipper" },
      { title: "RDX Zippered Men Sweat Vest" },
      { title: "RDX H2 Weight Loss Sauna Suit" },
      { title: "RDX H1 Weight Loss Sauna Suit" },
      { title: "RDX Sauna Sweat Leggings For Women" },
    ];
    const { products: matched, filtered, kind } = filterProductsByQueryRelevance(
      products,
      "sauna vests"
    );
    expect(kind).toBe("vest");
    expect(filtered).toBe(true);
    expect(matched).toHaveLength(4);
    expect(matched.every((p) => /vest/i.test(p.title))).toBe(true);
  });

  it("keeps boxing gloves and drops wraps", () => {
    const products = [
      { title: "RDX F6 Kara Boxing Training Gloves Black" },
      { title: "RDX F7 Ego Boxing Gloves" },
      { title: "RDX RP Hand Wraps for Boxing MMA" },
      { title: "RDX Focus Pads" },
    ];
    const { products: matched, kind } = filterProductsByQueryRelevance(
      products,
      "boxing gloves"
    );
    expect(kind).toBe("glove");
    expect(matched).toHaveLength(2);
    expect(matched.every((p) => /glove/i.test(p.title))).toBe(true);
  });

  it("prefers full multi-term match for shin guards", () => {
    const products = [
      { title: "RDX Shin Guards for MMA" },
      { title: "RDX T1 Black Head Guard" },
      { title: "RDX Groin Guard" },
    ];
    const { products: matched, kind } = filterProductsByQueryRelevance(
      products,
      "shin guards"
    );
    expect(kind).toBe("guard");
    expect(matched).toHaveLength(1);
    expect(matched[0]?.title).toContain("Shin");
  });

  it("keeps yoga mats by requiring yoga + mat when both appear", () => {
    const products = [
      { title: "RDX Yoga Mat 6mm" },
      { title: "RDX Yoga Block" },
      { title: "RDX Exercise Mat" },
    ];
    const { products: matched, kind } = filterProductsByQueryRelevance(
      products,
      "yoga mats"
    );
    expect(kind).toBe("mat");
    expect(matched.map((p) => p.title)).toEqual(["RDX Yoga Mat 6mm"]);
  });

  it("falls back to product kind when modifiers are absent from titles", () => {
    const products = [
      { title: "RDX Men Sweat Vest" },
      { title: "RDX Sauna Suit" },
    ];
    const { products: matched } = filterProductsByQueryRelevance(
      products,
      "sauna vest"
    );
    expect(matched).toHaveLength(1);
    expect(matched[0]?.title).toContain("Vest");
  });
});

describe("compactProduct", () => {
  it("strips HTML, maps stock, and detects sale", () => {
    const product = compactProduct({
      id: "gid://shopify/Product/1",
      title: "RDX F6 Kara Boxing Training Gloves Black",
      url: "https://rdxsports.co.uk/products/f6",
      description: {
        html: "<p>Maya Hide leather.</p><p>Max-Shock foam.</p>",
      },
      price_range: {
        min: { amount: 2999, currency: "GBP" },
        max: { amount: 2999, currency: "GBP" },
      },
      list_price_range: {
        min: { amount: 3499, currency: "GBP" },
        max: { amount: 3499, currency: "GBP" },
      },
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          title: "Black / 8oz",
          availability: { available: true },
          price: { amount: 2999, currency: "GBP" },
        },
        {
          id: "gid://shopify/ProductVariant/2",
          title: "Golden / 8oz",
          availability: { available: false },
          price: { amount: 2999, currency: "GBP" },
        },
      ],
    });

    expect(product).toMatchObject({
      title: "RDX F6 Kara Boxing Training Gloves Black",
      price: "£29.99",
      wasPrice: "£34.99",
      onSale: true,
      inStock: true,
      url: "https://rdxsports.co.uk/products/f6",
    });
    expect(product?.summary).toContain("Maya Hide leather");
    expect(product?.summary).not.toContain("<p>");
    expect(product?.options).toEqual([
      expect.objectContaining({ title: "Black / 8oz", available: true }),
      expect.objectContaining({ title: "Golden / 8oz", available: false }),
    ]);
  });

  it("marks out of stock when no variant is available", () => {
    const product = compactProduct({
      id: "gid://shopify/Product/2",
      title: "Sold Out Gloves",
      price_range: { min: { amount: 1000, currency: "GBP" } },
      list_price_range: { min: { amount: 0, currency: "GBP" } },
      variants: [
        {
          title: "Black / 10oz",
          availability: { available: false },
          price: { amount: 1000, currency: "GBP" },
        },
      ],
    });
    expect(product?.inStock).toBe(false);
    expect(product?.onSale).toBe(false);
    expect(product?.wasPrice).toBeNull();
  });
});

describe("compactCatalogMcpText", () => {
  it("compacts search payloads and shrinks huge HTML", () => {
    const hugeHtml = `<p>${"padding ".repeat(5000)}boxing gloves</p>`;
    const raw = JSON.stringify({
      ucp: { version: "2026-04-08" },
      products: [
        {
          id: "gid://shopify/Product/1",
          title: "RDX F6 Kara Boxing Training Gloves Black",
          url: "https://example.com/p/1",
          description: { html: hugeHtml },
          price_range: { min: { amount: 2999, currency: "GBP" } },
          list_price_range: { min: { amount: 0, currency: "GBP" } },
          variants: [
            {
              title: "Black / 8oz",
              availability: { available: true },
              description: { html: hugeHtml },
              price: { amount: 2999, currency: "GBP" },
            },
          ],
        },
      ],
      pagination: { has_next_page: true },
    });

    expect(raw.length).toBeGreaterThan(50_000);
    const compact = compactCatalogMcpText(raw);
    expect(compact.length).toBeLessThan(2_000);
    const parsed = JSON.parse(compact);
    expect(parsed.productCount).toBe(1);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.products[0].inStock).toBe(true);
    expect(parsed.products[0].title).toContain("F6 Kara");
  });

  it("filters sauna vest search down to vest titles only", () => {
    const raw = JSON.stringify({
      products: [
        {
          id: "gid://shopify/Product/1",
          title: "RDX M1 Men Sweat Vest Without Zipper",
          price_range: { min: { amount: 1999, currency: "GBP" } },
          variants: [
            {
              title: "Black / M",
              availability: { available: true },
              price: { amount: 1999, currency: "GBP" },
            },
          ],
        },
        {
          id: "gid://shopify/Product/2",
          title: "RDX H2 Weight Loss Sauna Suit",
          price_range: { min: { amount: 4399, currency: "GBP" } },
          variants: [
            {
              title: "Black / M",
              availability: { available: true },
              price: { amount: 4399, currency: "GBP" },
            },
          ],
        },
        {
          id: "gid://shopify/Product/3",
          title: "RDX W1 Women Sweat Vest Without Zipper",
          price_range: { min: { amount: 2099, currency: "GBP" } },
          variants: [
            {
              title: "Black / S",
              availability: { available: true },
              price: { amount: 2099, currency: "GBP" },
            },
          ],
        },
      ],
    });
    const parsed = JSON.parse(
      compactCatalogMcpText(raw, { query: "sauna vests" })
    );
    expect(parsed.rawHitCount).toBe(3);
    expect(parsed.productCount).toBe(2);
    expect(parsed.relevanceFiltered).toBe(true);
    expect(parsed.matchedKind).toBe("vest");
    expect(parsed.products.map((p: { title: string }) => p.title)).toEqual([
      "RDX M1 Men Sweat Vest Without Zipper",
      "RDX W1 Women Sweat Vest Without Zipper",
    ]);
  });

  it("compacts get_product shape", () => {
    const raw = JSON.stringify({
      product: {
        id: "gid://shopify/Product/9",
        title: "Test Product",
        url: "https://example.com/p/9",
        price_range: { min: { amount: 500, currency: "GBP" } },
        variants: [
          {
            title: "Default",
            availability: { available: true },
            price: { amount: 500, currency: "GBP" },
          },
        ],
      },
    });
    const parsed = JSON.parse(compactCatalogMcpText(raw));
    expect(parsed.product.title).toBe("Test Product");
    expect(parsed.product.inStock).toBe(true);
  });

  it("leaves non-catalog text unchanged", () => {
    expect(compactCatalogMcpText("Shipping takes 3-5 days.")).toBe(
      "Shipping takes 3-5 days."
    );
  });
});

describe("normalizeSearchQuery", () => {
  it("corrects common boxing typos", () => {
    expect(normalizeSearchQuery("bosing")).toBe("boxing");
    expect(normalizeSearchQuery("Boxng")).toBe("boxing");
    expect(normalizeSearchQuery("boxing gloves")).toBe("boxing gloves");
  });
});
