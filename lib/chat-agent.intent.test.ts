import { describe, expect, it } from "vitest";
import {
  extractCategoryIntent,
  extractCategoryStructureIntent,
  extractLastCategoryFromHistory,
  extractListQuantity,
  extractOrderLookupToken,
  hasRecentProductContext,
  isBareOrderNumberToken,
  isBrowseClarifyQuery,
  isCatalogCountQuery,
  isCategoryFollowUpQuery,
  isCategoryQuery,
  isCategoryStructureQuery,
  isOffTopicQuery,
  isOrderTrackingIntent,
  isProductFollowUpQuery,
  shouldForceProductSearch,
  wantsInStockOnly,
} from "@/lib/chat-agent";

describe("isOrderTrackingIntent", () => {
  it("matches common tracking phrases", () => {
    expect(isOrderTrackingIntent("track my order")).toBe(true);
    expect(isOrderTrackingIntent("track this order")).toBe(true);
    expect(isOrderTrackingIntent("track the order")).toBe(true);
    expect(isOrderTrackingIntent("track order")).toBe(true);
    expect(isOrderTrackingIntent("Track Your Order")).toBe(true);
    expect(isOrderTrackingIntent("where is my order")).toBe(true);
    expect(isOrderTrackingIntent("where is my package")).toBe(true);
    expect(isOrderTrackingIntent("order status")).toBe(true);
    expect(isOrderTrackingIntent("order tracking")).toBe(true);
  });

  it("does not match product questions", () => {
    expect(isOrderTrackingIntent("boxing gloves")).toBe(false);
    expect(isOrderTrackingIntent("what is the capital of germany")).toBe(false);
  });
});

describe("shouldForceProductSearch", () => {
  it("forces search for specific product-like messages", () => {
    expect(shouldForceProductSearch("do you sell shin guards")).toBe(true);
    expect(shouldForceProductSearch("looking for kids punch bag")).toBe(true);
    expect(shouldForceProductSearch("robo kids punch")).toBe(true);
    expect(shouldForceProductSearch("RDX F6 Kara Boxing Training Gloves")).toBe(
      true
    );
  });

  it("does not force keyword search for ambiguous browse terms", () => {
    expect(shouldForceProductSearch("boxing gloves")).toBe(false);
    expect(shouldForceProductSearch("boxing")).toBe(false);
    expect(shouldForceProductSearch("gloves")).toBe(false);
    expect(shouldForceProductSearch("mma")).toBe(false);
  });

  it("does not force search for tracking, off-topic, or bare order numbers", () => {
    expect(shouldForceProductSearch("track this order")).toBe(false);
    expect(shouldForceProductSearch("what is the capital of germany")).toBe(
      false
    );
    expect(shouldForceProductSearch("1001")).toBe(false);
    expect(shouldForceProductSearch("find 1001")).toBe(false);
    expect(shouldForceProductSearch("hello")).toBe(false);
  });

  it("does not force search for whole-catalog count questions", () => {
    expect(shouldForceProductSearch("how many total products we have")).toBe(
      false
    );
    expect(shouldForceProductSearch("overall, how many products we have")).toBe(
      false
    );
  });
});

describe("isCatalogCountQuery", () => {
  it("matches whole-catalog total questions", () => {
    expect(isCatalogCountQuery("how many total products we have")).toBe(true);
    expect(isCatalogCountQuery("overall, how many products we have")).toBe(
      true
    );
    expect(isCatalogCountQuery("how many products do you have")).toBe(true);
    expect(
      isCatalogCountQuery("not related to boxing but overall in all categories")
    ).toBe(true);
    expect(isCatalogCountQuery("how many products across all categories")).toBe(
      true
    );
  });

  it("does not match narrow category searches", () => {
    expect(isCatalogCountQuery("how many boxing gloves")).toBe(false);
    expect(isCatalogCountQuery("boxing gloves")).toBe(false);
    expect(isCatalogCountQuery("track this order")).toBe(false);
    expect(
      isCatalogCountQuery(
        "under yoga category i need list of all yoga related products count"
      )
    ).toBe(false);
  });
});

describe("extractCategoryIntent", () => {
  it("detects category count questions", () => {
    expect(
      extractCategoryIntent(
        "under yoga category i need list of all yoga related products count"
      )
    ).toEqual({ category: "yoga", mode: "count" });
    expect(extractCategoryIntent("how many yoga products")).toEqual({
      category: "yoga",
      mode: "count",
    });
    expect(extractCategoryIntent("yoga category product count")).toEqual({
      category: "yoga",
      mode: "count",
    });
    expect(extractCategoryIntent("how many boxing gloves")).toEqual({
      category: "boxing gloves",
      mode: "count",
    });
    expect(
      extractCategoryIntent("in boxing gloves we have how many products")
    ).toEqual({ category: "boxing gloves", mode: "count" });
    expect(
      extractCategoryIntent("how many products we have in strength training")
    ).toEqual({ category: "strength training", mode: "count" });
  });

  it("detects category list questions", () => {
    expect(extractCategoryIntent("show me yoga products")).toEqual({
      category: "yoga",
      mode: "list",
    });
    expect(extractCategoryIntent("list products in the boxing category")).toEqual(
      {
        category: "boxing",
        mode: "list",
      }
    );
    expect(extractCategoryIntent("list all boxing gloves")).toEqual({
      category: "boxing gloves",
      mode: "list",
    });
    expect(extractCategoryIntent("list these products in belt")).toEqual({
      category: "belt",
      mode: "list",
    });
    expect(extractCategoryIntent("list these products in belts")).toEqual({
      category: "belts",
      mode: "list",
    });
  });

  it("parses list quantity without treating the number as the category", () => {
    expect(extractListQuantity("list 20 boxing gloves")).toBe(20);
    expect(extractCategoryIntent("list 20 boxing gloves")).toEqual({
      category: "boxing gloves",
      mode: "list",
      limit: 20,
    });
    expect(extractCategoryIntent("show me 10 yoga mats")).toEqual({
      category: "yoga mats",
      mode: "list",
      limit: 10,
    });
  });

  it("treats bare browse phrases as clarify intent", () => {
    expect(isBrowseClarifyQuery("boxing")).toBe(true);
    expect(isBrowseClarifyQuery("gloves")).toBe(true);
    expect(isBrowseClarifyQuery("boxing gloves")).toBe(true);
    expect(extractCategoryIntent("boxing")).toEqual({
      category: "boxing",
      mode: "list",
      clarify: true,
    });
    expect(extractCategoryIntent("boxing gloves")).toEqual({
      category: "boxing gloves",
      mode: "list",
      clarify: true,
    });
    expect(extractCategoryIntent("mma")).toEqual({
      category: "mma",
      mode: "list",
      clarify: true,
    });
  });

  it("recognises mega-menu subcategory and series browse phrases", () => {
    expect(isBrowseClarifyQuery("gym belts")).toBe(true);
    expect(isBrowseClarifyQuery("yoga mats")).toBe(true);
    expect(isBrowseClarifyQuery("kara")).toBe(true);
    expect(isBrowseClarifyQuery("freestanding punch bags")).toBe(true);
    expect(isBrowseClarifyQuery("immaf approved")).toBe(true);
    expect(isBrowseClarifyQuery("strength training")).toBe(true);
    expect(isBrowseClarifyQuery("collections")).toBe(true);
    expect(extractCategoryIntent("kara")).toEqual({
      category: "kara",
      mode: "list",
      clarify: true,
    });
    expect(extractCategoryIntent("how many gym belts")).toEqual({
      category: "gym belts",
      mode: "count",
    });
    expect(extractCategoryIntent("list products in collections")).toEqual({
      category: "collections",
      mode: "list",
    });
    expect(
      extractCategoryIntent("how many freestanding punch bags")
    ).toEqual({
      category: "freestanding punch bags",
      mode: "count",
    });
  });

  it("does not treat whole-catalog totals as a category", () => {
    expect(extractCategoryIntent("how many products across all categories")).toBe(
      null
    );
    expect(extractCategoryIntent("how many products do you have")).toBe(null);
  });
});

describe("extractCategoryStructureIntent", () => {
  it("detects top-level category questions", () => {
    expect(extractCategoryStructureIntent("what categories do you have")).toEqual(
      { category: null }
    );
    expect(
      extractCategoryStructureIntent("how many categories are there")
    ).toEqual({ category: null });
    expect(
      extractCategoryStructureIntent("list all the categories in the store")
    ).toEqual({ category: null });
    expect(extractCategoryStructureIntent("categories?")).toEqual({
      category: null,
    });
  });

  it("detects subcategory questions with a target category", () => {
    expect(
      extractCategoryStructureIntent("what subcategories does boxing have")
    ).toEqual({ category: "boxing" });
    expect(
      extractCategoryStructureIntent("how many subcategories are there in mma")
    ).toEqual({ category: "mma" });
    expect(
      extractCategoryStructureIntent("what categories are in fitness")
    ).toEqual({ category: "fitness" });
    expect(extractCategoryStructureIntent("boxing sub categories")).toEqual({
      category: "boxing",
    });
  });

  it("does not match product-in-category questions", () => {
    expect(
      extractCategoryStructureIntent("how many products in the yoga category")
    ).toBeNull();
    expect(
      extractCategoryStructureIntent("list products in the boxing category")
    ).toBeNull();
    expect(
      extractCategoryStructureIntent("yoga category product count")
    ).toBeNull();
    expect(extractCategoryStructureIntent("boxing gloves")).toBeNull();
  });

  it("keeps category product intents working", () => {
    expect(extractCategoryIntent("what categories do you have")).toBeNull();
    expect(extractCategoryIntent("how many categories do we have")).toBeNull();
    expect(extractCategoryIntent("how many boxing gloves")).toEqual({
      category: "boxing gloves",
      mode: "count",
    });
  });

  it("is not treated as off-topic or forced product search", () => {
    expect(isOffTopicQuery("how many categories do you have")).toBe(false);
    expect(isOffTopicQuery("what subcategories does boxing have")).toBe(false);
    expect(shouldForceProductSearch("what categories do you have")).toBe(false);
    expect(isCategoryStructureQuery("what subcategories does boxing have")).toBe(
      true
    );
  });
});

describe("shouldForceProductSearch with categories", () => {
  it("does not force keyword search for category count", () => {
    expect(
      shouldForceProductSearch(
        "under yoga category i need list of all yoga related products count"
      )
    ).toBe(false);
    expect(shouldForceProductSearch("how many boxing gloves")).toBe(false);
    expect(shouldForceProductSearch("list 20 boxing gloves")).toBe(false);
  });
});

describe("category follow-ups", () => {
  it("detects list-the-ones / in-stock follow-ups", () => {
    expect(isCategoryFollowUpQuery("list the ones which are in stock")).toBe(
      true
    );
    expect(wantsInStockOnly("list the ones which are in stock")).toBe(true);
    expect(isCategoryFollowUpQuery("how many boxing gloves")).toBe(false);
  });

  it("recovers category from prior turns", () => {
    expect(
      extractLastCategoryFromHistory([
        {
          role: "user",
          content: "how many products we have in strength training",
        },
        {
          role: "assistant",
          content: "There are 26 products in the Strength Training category.",
        },
        { role: "user", content: "list the ones which are in stock" },
      ])
    ).toBe("strength training");
  });
});

describe("isOffTopicQuery", () => {
  it("detects trivia and general knowledge", () => {
    expect(isOffTopicQuery("what is the capital of germany")).toBe(true);
    expect(isOffTopicQuery("who is the president of france")).toBe(true);
  });

  it("does not flag shopping questions", () => {
    expect(isOffTopicQuery("what is the price of boxing gloves")).toBe(false);
    expect(isOffTopicQuery("track this order")).toBe(false);
    expect(isOffTopicQuery("boxing gloves")).toBe(false);
  });

  it("does not flag product follow-ups as off-topic", () => {
    expect(
      isOffTopicQuery("what is the difference between the two of them")
    ).toBe(false);
    expect(isOffTopicQuery("which one is better")).toBe(false);
    expect(isOffTopicQuery("what about the black one")).toBe(false);
  });
});

describe("isProductFollowUpQuery", () => {
  it("detects comparison and pronoun follow-ups", () => {
    expect(
      isProductFollowUpQuery("what is the difference between the two of them")
    ).toBe(true);
    expect(isProductFollowUpQuery("which one should I get")).toBe(true);
    expect(isProductFollowUpQuery("how about the 14oz")).toBe(true);
  });

  it("does not treat trivia as a follow-up", () => {
    expect(
      isProductFollowUpQuery("what is the capital of germany")
    ).toBe(false);
  });
});

describe("hasRecentProductContext", () => {
  it("detects prior product detail replies", () => {
    expect(
      hasRecentProductContext([
        { role: "user", content: "RDX F6 Kara Boxing Training Gloves Black" },
        {
          role: "assistant",
          content:
            "**RDX F6 Kara Boxing Training Gloves Black**\n**Price:** £29.99\n**Key features**\n- Durable leather",
        },
      ])
    ).toBe(true);
  });
});

describe("extractOrderLookupToken", () => {
  it("extracts bare and prefixed order numbers", () => {
    expect(extractOrderLookupToken("1001")).toBe("1001");
    expect(extractOrderLookupToken("#1001")).toBe("1001");
    expect(extractOrderLookupToken("find 1001")).toBe("1001");
    expect(extractOrderLookupToken("check #1001")).toBe("1001");
    expect(extractOrderLookupToken("OT-cbn4m39wmd")).toBe("OT-cbn4m39wmd");
  });

  it("does not treat product phrases as order numbers", () => {
    expect(extractOrderLookupToken("find boxing gloves")).toBeNull();
    expect(extractOrderLookupToken("track this order")).toBeNull();
    expect(isBareOrderNumberToken("boxing gloves")).toBe(false);
  });
});

describe("isCategoryQuery", () => {
  it("matches bare browse and explicit list/count", () => {
    expect(isCategoryQuery("boxing gloves")).toBe(true);
    expect(isCategoryQuery("list 20 boxing gloves")).toBe(true);
    expect(isCategoryQuery("how many boxing gloves")).toBe(true);
  });
});
