import { describe, expect, it } from "vitest";
import {
  buildContextBlock,
  extractShownProducts,
  MAX_SHOWN_PRODUCTS,
  type ShownProduct,
} from "@/lib/chat/context/product-memory";

function wrap(json: string): string {
  return `<CATALOG_DATA>\n${json}\n</CATALOG_DATA>\n\nsome trusted hint`;
}

describe("extractShownProducts", () => {
  it("extracts products from a wrapped search result", () => {
    const result = wrap(
      JSON.stringify({
        productCount: 2,
        products: [
          {
            id: "gid://shopify/Product/1",
            title: "RDX F6 Kara",
            price: "£32.99",
            url: "https://shop/f6",
            inStock: true,
            onSale: false,
          },
          {
            id: "gid://shopify/Product/2",
            title: "RDX Aura Plus",
            price: "£44.99",
            url: null,
            inStock: false,
            onSale: true,
          },
        ],
      }),
    );

    const shown = extractShownProducts(result);
    expect(shown).toHaveLength(2);
    expect(shown[0]).toEqual({
      id: "gid://shopify/Product/1",
      title: "RDX F6 Kara",
      price: "£32.99",
      wasPrice: null,
      url: "https://shop/f6",
      inStock: true,
      onSale: false,
    });
    expect(shown[1]!.inStock).toBe(false);
    expect(shown[1]!.onSale).toBe(true);
  });

  it("extracts a single product from a get_product result", () => {
    const result = wrap(
      JSON.stringify({
        product: {
          id: "gid://shopify/Product/9",
          title: "RDX F15 Noir",
          price: "£59.99",
          url: "https://shop/f15",
          inStock: true,
          onSale: false,
        },
      }),
    );
    const shown = extractShownProducts(result);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe("RDX F15 Noir");
  });

  it("accepts raw (unwrapped) compacted JSON", () => {
    const shown = extractShownProducts(
      JSON.stringify({
        products: [{ id: "1", title: "Glove" }],
      }),
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ id: "1", title: "Glove", inStock: false });
  });

  it("drops entries missing id or title, and caps the list", () => {
    const products = Array.from({ length: MAX_SHOWN_PRODUCTS + 5 }, (_, i) => ({
      id: `id-${i}`,
      title: `Product ${i}`,
    }));
    products.push({ id: "", title: "no id" } as never);
    const shown = extractShownProducts(wrap(JSON.stringify({ products })));
    expect(shown).toHaveLength(MAX_SHOWN_PRODUCTS);
  });

  it("returns empty for empty results and malformed JSON", () => {
    expect(extractShownProducts("")).toEqual([]);
    expect(extractShownProducts(wrap("{}"))).toEqual([]);
    expect(extractShownProducts("not json")).toEqual([]);
    expect(extractShownProducts(wrap('{"products": []}'))).toEqual([]);
  });
});

describe("buildContextBlock", () => {
  const products: ShownProduct[] = [
    {
      id: "gid://1",
      title: "RDX F6 Kara",
      price: "£32.99",
      wasPrice: null,
      url: null,
      inStock: true,
      onSale: false,
    },
    {
      id: "gid://2",
      title: "RDX Aura Plus",
      price: "£44.99",
      wasPrice: "£49.99",
      url: null,
      inStock: false,
      onSale: true,
    },
  ];

  it("returns null when there is nothing to remember", () => {
    expect(buildContextBlock(null)).toBeNull();
    expect(buildContextBlock([])).toBeNull();
  });

  it("lists products with price, wasPrice, stock, sale, and id", () => {
    const productsWithWas: ShownProduct[] = [
      ...products,
      {
        id: "gid://3",
        title: "RDX T15",
        price: "£29.99",
        wasPrice: "£39.99",
        url: null,
        inStock: true,
        onSale: true,
      },
    ];
    const block = buildContextBlock(productsWithWas)!;
    expect(block).toContain("CONVERSATION CONTEXT");
    expect(block).toContain("1. RDX F6 Kara — £32.99 — In stock (id: gid://1)");
    expect(block).toContain(
      "2. RDX Aura Plus — £44.99 (was £49.99) — Out of stock — On sale (id: gid://2)",
    );
    expect(block).toContain(
      "3. RDX T15 — £29.99 (was £39.99) — In stock — On sale (id: gid://3)",
    );
    expect(block).toContain("FOLLOW-UP RULES (CRITICAL)");
    expect(block).toContain("get_inventory");
  });

  it("caps remembered products at 20 for list-mode follow-ups", () => {
    expect(MAX_SHOWN_PRODUCTS).toBe(20);
  });

  it("includes last catalog search query when provided", () => {
    const block = buildContextBlock(products, "sparring gloves")!;
    expect(block).toContain('Last catalog search query: "sparring gloves"');
    expect(block).toContain("FOLLOW-UP RULES");
  });

  it("includes active topic when provided via options", () => {
    const block = buildContextBlock(products, {
      lastSearchQuery: "f4 gloves",
      pendingCategory: "boxing gloves",
    })!;
    expect(block).toContain('Active topic / category: "boxing gloves"');
    expect(block).toContain("show cheaper ones");
  });
});
