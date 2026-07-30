import { describe, expect, it } from "vitest";
import {
  freezeSearchIntoContext,
  emptyCatalogContext,
} from "@/lib/chat/context/conversation-context";
import { lookupCanonicalCache } from "@/lib/chat/search/canonical-cache";

describe("conversation catalog context", () => {
  it("freezes search results for follow-up reuse", () => {
    const ctx = freezeSearchIntoContext(emptyCatalogContext(), {
      canonicalSearch: "yoga strap",
      products: [
        {
          id: "1",
          title: "Cotton Yoga Strap",
          price: "£10",
          wasPrice: null,
          url: null,
          inStock: true,
          onSale: false,
        },
      ],
      totalCount: 1,
      category: "Yoga Straps",
    });

    expect(ctx.canonicalSearch).toBe("yoga strap");
    expect(ctx.matchingProductIds).toEqual(["1"]);

    const hit = lookupCanonicalCache(ctx, "yoga strap", {});
    expect(hit?.products).toHaveLength(1);
    expect(hit?.totalCount).toBe(1);

    const miss = lookupCanonicalCache(ctx, "yoga mat", {});
    expect(miss).toBeNull();
  });
});
