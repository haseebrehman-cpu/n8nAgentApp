import { describe, expect, it } from "vitest";
import {
  collectionMatchesQueryTerms,
  pickCategoryCollectionFromMcpSearch,
} from "@/lib/shopify/storefront-collection";

describe("collectionMatchesQueryTerms", () => {
  it("matches boxing Headgear collection for head guards", () => {
    expect(
      collectionMatchesQueryTerms(
        "boxing Headgear",
        "boxing-protective-gear-head-guards",
        ["head", "guard"],
      ),
    ).toBe(true);
  });

  it("rejects shin guard collections for head guards", () => {
    expect(
      collectionMatchesQueryTerms(
        "Shin Guards",
        "boxing-protective-gear-shin-guards",
        ["head", "guard"],
      ),
    ).toBe(false);
  });
});

describe("pickCategoryCollectionFromMcpSearch", () => {
  it("prefers Boxing headgear collection over sale/MMA for head guards", () => {
    const raw = JSON.stringify({
      products: [
        {
          title: "A",
          collections: [
            {
              title: "boxing Headgear",
              handle: "boxing-protective-gear-head-guards",
            },
          ],
        },
        {
          title: "B",
          collections: [
            {
              title: "boxing Headgear",
              handle: "boxing-protective-gear-head-guards",
            },
          ],
        },
        {
          title: "C",
          collections: [
            { title: "MMA Headgear", handle: "mma-protective-gear-head-guards" },
          ],
        },
        {
          title: "D",
          collections: [
            {
              title: "Head Guards",
              handle: "sale-deals-protective-gear-head-guards",
            },
          ],
        },
      ],
    });

    const picked = pickCategoryCollectionFromMcpSearch(raw, "head guards");
    expect(picked?.handle).toBe("boxing-protective-gear-head-guards");
  });

  it("prefers MMA collection when the query says mma", () => {
    const raw = JSON.stringify({
      products: [
        {
          title: "A",
          collections: [
            {
              title: "boxing Headgear",
              handle: "boxing-protective-gear-head-guards",
            },
          ],
        },
        {
          title: "B",
          collections: [
            { title: "MMA Headgear", handle: "mma-protective-gear-head-guards" },
          ],
        },
      ],
    });

    const picked = pickCategoryCollectionFromMcpSearch(raw, "mma head guards");
    expect(picked?.handle).toBe("mma-protective-gear-head-guards");
  });
});
