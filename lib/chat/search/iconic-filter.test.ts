import { describe, expect, it } from "vitest";
import {
  excludeIconicProductsUnlessRequested,
  isIconicProduct,
  queryRequestsIconic,
} from "@/lib/chat/search/iconic-filter";
import { compactCatalogMcpText } from "@/lib/shopify/compact-catalog";

describe("iconic product filter", () => {
  it("detects iconic in title, url, or collections", () => {
    expect(
      isIconicProduct({ title: "RDX Iconic Yoga Strap" }),
    ).toBe(true);
    expect(
      isIconicProduct({
        title: "Cotton Yoga Strap",
        collections: ["Iconic Gear"],
      }),
    ).toBe(true);
    expect(
      isIconicProduct({
        title: "Cotton Yoga Strap",
        url: "https://example.com/products/iconic-yoga-strap",
      }),
    ).toBe(true);
    expect(isIconicProduct({ title: "Cotton Yoga Strap" })).toBe(false);
  });

  it("excludes iconic products unless the query asks for them", () => {
    const products = [
      { id: "1", title: "Cotton Yoga Strap" },
      { id: "2", title: "Iconic Range Yoga Strap" },
      { id: "3", title: "Basic Yoga Strap", collections: ["Iconic Gear"] },
    ];
    const filtered = excludeIconicProductsUnlessRequested(
      products,
      "yoga straps",
    );
    expect(filtered.map((p) => p.id)).toEqual(["1"]);

    const withIconic = excludeIconicProductsUnlessRequested(
      products,
      "iconic yoga straps",
    );
    expect(withIconic).toHaveLength(3);
  });

  it("recognizes iconic intent in the query", () => {
    expect(queryRequestsIconic("show iconic gear")).toBe(true);
    expect(queryRequestsIconic("yoga straps")).toBe(false);
  });

  it("compactCatalogMcpText drops iconic unless queried", () => {
    const raw = JSON.stringify({
      products: [
        {
          id: "gid://shopify/Product/1",
          title: "Yoga Strap Cotton",
          variants: [{ title: "Default", availability: { available: true } }],
        },
        {
          id: "gid://shopify/Product/2",
          title: "Iconic Yoga Strap",
          variants: [{ title: "Default", availability: { available: true } }],
        },
      ],
    });

    const without = JSON.parse(
      compactCatalogMcpText(raw, { query: "yoga straps", skipRelevanceFilter: true }),
    ) as { productCount: number; products: { title: string }[] };
    expect(without.productCount).toBe(1);
    expect(without.products[0]?.title).toBe("Yoga Strap Cotton");

    const withIconic = JSON.parse(
      compactCatalogMcpText(raw, {
        query: "iconic yoga straps",
        skipRelevanceFilter: true,
      }),
    ) as { productCount: number };
    expect(withIconic.productCount).toBe(2);
  });
});
