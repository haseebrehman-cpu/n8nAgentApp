import { describe, expect, it } from "vitest";
import {
  shownProductsToCatalogJson,
  tryFilterLastShownProducts,
} from "@/lib/chat/search/context-filter";
import type { ShownProduct } from "@/lib/chat/context/product-memory";

const shown: ShownProduct[] = [
  {
    id: "1",
    title: "RDX Blue Sparring Gloves",
    price: "£29.99",
    wasPrice: null,
    url: null,
    inStock: true,
    onSale: false,
  },
  {
    id: "2",
    title: "RDX Red Sparring Gloves",
    price: "£29.99",
    wasPrice: null,
    url: null,
    inStock: true,
    onSale: false,
  },
];

describe("tryFilterLastShownProducts", () => {
  it("filters prior results by colour without needing MCP", () => {
    const result = tryFilterLastShownProducts({
      lastUser: "only blue ones",
      lastSearchQuery: "sparring gloves",
      lastShownProducts: shown,
    });
    expect(result.usable).toBe(true);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]!.title).toMatch(/Blue/i);
  });

  it("returns unusable when filter empties the list", () => {
    const result = tryFilterLastShownProducts({
      lastUser: "only green ones",
      lastSearchQuery: "sparring gloves",
      lastShownProducts: shown,
    });
    expect(result.usable).toBe(false);
  });

  it("filters to cheaper products from a prior comparison shortlist", () => {
    const priced: ShownProduct[] = [
      {
        id: "1",
        title: "RDX F4 Gloves",
        price: "£29.99",
        wasPrice: null,
        url: null,
        inStock: true,
        onSale: false,
      },
      {
        id: "2",
        title: "RDX F6 Kara Gloves",
        price: "£44.99",
        wasPrice: null,
        url: null,
        inStock: true,
        onSale: false,
      },
    ];
    const result = tryFilterLastShownProducts({
      lastUser: "show cheaper ones",
      lastSearchQuery: "f4 f6 gloves",
      lastShownProducts: priced,
    });
    expect(result.usable).toBe(true);
    expect(result.products.some((p) => p.title.includes("F4"))).toBe(true);
    expect(result.products.every((p) => p.title.includes("F6"))).toBe(false);
  });
});

describe("shownProductsToCatalogJson", () => {
  it("emits catalog-shaped JSON with reusedContext", () => {
    const json = JSON.parse(shownProductsToCatalogJson(shown, "blue gloves"));
    expect(json.productCount).toBe(2);
    expect(json.reusedContext).toBe(true);
    expect(json.products[0].id).toBe("1");
  });
});
