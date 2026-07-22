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
      url: null,
      inStock: true,
      onSale: false,
    },
    {
      id: "gid://2",
      title: "RDX Aura Plus",
      price: "£44.99",
      url: null,
      inStock: false,
      onSale: true,
    },
  ];

  it("returns null when there is nothing to remember", () => {
    expect(buildContextBlock(null)).toBeNull();
    expect(buildContextBlock([])).toBeNull();
  });

  it("lists products with price, stock, sale, and id", () => {
    const block = buildContextBlock(products)!;
    expect(block).toContain("CONVERSATION CONTEXT");
    expect(block).toContain("1. RDX F6 Kara — £32.99 — In stock (id: gid://1)");
    expect(block).toContain(
      "2. RDX Aura Plus — £44.99 — Out of stock — On sale (id: gid://2)",
    );
  });
});
