import { describe, expect, it } from "vitest";
import {
  collectionMatchesQueryTerms,
  isScopedSubcategoryQuery,
  pickCategoryCollectionFromMcpSearch,
  pickCategoryCollectionsFromMcpSearch,
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

describe("isScopedSubcategoryQuery", () => {
  it("treats parent category phrases as unscoped", () => {
    expect(isScopedSubcategoryQuery("boxing gloves")).toBe(false);
    expect(isScopedSubcategoryQuery("head guards")).toBe(false);
    expect(isScopedSubcategoryQuery("how many boxing gloves")).toBe(false);
  });

  it("treats use-case modifiers as scoped subcategories", () => {
    expect(isScopedSubcategoryQuery("training boxing gloves")).toBe(true);
    expect(isScopedSubcategoryQuery("competition gloves")).toBe(true);
    expect(isScopedSubcategoryQuery("sparring boxing gloves")).toBe(true);
    expect(isScopedSubcategoryQuery("kids boxing gloves")).toBe(true);
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

describe("pickCategoryCollectionsFromMcpSearch", () => {
  const boxingGlovesMcp = JSON.stringify({
    products: [
      {
        title: "Training Glove 1",
        collections: [
          {
            title: "Training Boxing Gloves",
            handle: "boxing-gloves-training",
          },
        ],
      },
      {
        title: "Training Glove 2",
        collections: [
          {
            title: "Training Boxing Gloves",
            handle: "boxing-gloves-training",
          },
        ],
      },
      {
        title: "Competition Glove 1",
        collections: [
          {
            title: "Competition Boxing Gloves",
            handle: "boxing-gloves-competition",
          },
        ],
      },
      {
        title: "Sparring Glove 1",
        collections: [
          {
            title: "Sparring Boxing Gloves",
            handle: "boxing-gloves-sparring",
          },
        ],
      },
      {
        title: "Bag Work Glove 1",
        collections: [
          {
            title: "Bag Work Boxing Gloves",
            handle: "boxing-gloves-bag-work",
          },
        ],
      },
      {
        title: "Kids Glove 1",
        collections: [
          {
            title: "Kids Boxing Gloves",
            handle: "kids-boxing-gloves",
          },
        ],
      },
      {
        title: "Sale Glove 1",
        collections: [
          {
            title: "Sale Boxing Gloves",
            handle: "sale-deals-boxing-gloves",
          },
        ],
      },
      {
        title: "MMA Glove 1",
        collections: [
          {
            title: "MMA Boxing Style Gloves",
            handle: "mma-boxing-gloves",
          },
        ],
      },
    ],
  });

  it("aggregates all boxing glove subcategories for a parent query", () => {
    const picked = pickCategoryCollectionsFromMcpSearch(
      boxingGlovesMcp,
      "boxing gloves",
    );
    const handles = picked.map((c) => c.handle).sort();
    expect(handles).toEqual([
      "boxing-gloves-bag-work",
      "boxing-gloves-competition",
      "boxing-gloves-sparring",
      "boxing-gloves-training",
    ]);
  });

  it("scopes to one subcategory when the query names a use-case", () => {
    const picked = pickCategoryCollectionsFromMcpSearch(
      boxingGlovesMcp,
      "training boxing gloves",
    );
    expect(picked).toHaveLength(1);
    expect(picked[0]?.handle).toBe("boxing-gloves-training");
  });

  it("scopes competition gloves to the competition collection", () => {
    const picked = pickCategoryCollectionsFromMcpSearch(
      boxingGlovesMcp,
      "competition boxing gloves",
    );
    expect(picked).toHaveLength(1);
    expect(picked[0]?.handle).toBe("boxing-gloves-competition");
  });
});
