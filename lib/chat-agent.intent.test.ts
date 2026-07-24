import { describe, expect, it } from "vitest";
import {
  extractOrderLookupToken,
  hasExplicitCatalogListOrCountIntent,
  hasRecentProductContext,
  isAmbiguousBrowseQuery,
  isBareOrderNumberToken,
  isCategoryBrowseQuery,
  isDiscountCodeQuery,
  isExplicitCatalogListQuery,
  isInventoryQuantityQuery,
  // isHarmfulQuery — temporarily disabled in intent/safety
  isOffTopicQuery,
  isOrderTrackingIntent,
  isProductFollowUpQuery,
  needsProductClarification,
  resolveCatalogResponseMode,
  shouldForceProductSearch,
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

describe("isDiscountCodeQuery", () => {
  it("detects code/coupon requests", () => {
    expect(isDiscountCodeQuery("do you have a discount code")).toBe(true);
    expect(isDiscountCodeQuery("any promo codes?")).toBe(true);
    expect(isDiscountCodeQuery("coupon")).toBe(true);
  });

  it("does not flag general sale questions", () => {
    expect(isDiscountCodeQuery("what is on sale")).toBe(false);
    expect(isDiscountCodeQuery("any discounted boxing gloves")).toBe(false);
  });
});

describe("isAmbiguousBrowseQuery", () => {
  it("flags bare category phrases", () => {
    expect(isAmbiguousBrowseQuery("boxing")).toBe(true);
    expect(isAmbiguousBrowseQuery("gloves")).toBe(true);
    expect(isAmbiguousBrowseQuery("boxing gloves")).toBe(true);
    expect(isAmbiguousBrowseQuery("Boxing Gloves?")).toBe(true);
    expect(isAmbiguousBrowseQuery("mma")).toBe(true);
  });

  it("does not flag explicit list/count or already-narrow queries", () => {
    expect(isAmbiguousBrowseQuery("show me boxing gloves")).toBe(false);
    expect(isAmbiguousBrowseQuery("list boxing gloves")).toBe(false);
    expect(isAmbiguousBrowseQuery("how many boxing gloves")).toBe(false);
    expect(isAmbiguousBrowseQuery("training boxing gloves")).toBe(false);
    expect(isAmbiguousBrowseQuery("RDX F6 Kara Boxing Training Gloves")).toBe(
      false
    );
    expect(hasExplicitCatalogListOrCountIntent("show me boxing gloves")).toBe(
      true
    );
  });
});

describe("isExplicitCatalogListQuery", () => {
  it("matches show/list all/every phrasing", () => {
    expect(isExplicitCatalogListQuery("Show all boxing gloves")).toBe(true);
    expect(isExplicitCatalogListQuery("list every MMA glove")).toBe(true);
    expect(isExplicitCatalogListQuery("show all products in this category")).toBe(
      true,
    );
    expect(isExplicitCatalogListQuery("give me all head guards")).toBe(true);
  });

  it("does not match soft show/list without all/every", () => {
    expect(isExplicitCatalogListQuery("show me boxing gloves")).toBe(false);
    expect(isExplicitCatalogListQuery("list boxing gloves")).toBe(false);
    expect(isExplicitCatalogListQuery("boxing gloves")).toBe(false);
  });
});

describe("isInventoryQuantityQuery", () => {
  it("matches unit / inventory asks", () => {
    expect(isInventoryQuantityQuery("How many are available?")).toBe(true);
    expect(isInventoryQuantityQuery("What's the inventory?")).toBe(true);
    expect(isInventoryQuantityQuery("how many of these are left")).toBe(true);
    expect(isInventoryQuantityQuery("Is this product in stock?")).toBe(true);
    expect(
      isInventoryQuantityQuery("How many RDX T15 gloves are available?"),
    ).toBe(true);
  });

  it("does not match category counts", () => {
    expect(isInventoryQuantityQuery("how many boxing gloves")).toBe(false);
    expect(isInventoryQuantityQuery("how many head guards")).toBe(false);
  });
});

describe("isCategoryBrowseQuery / resolveCatalogResponseMode", () => {
  it("treats bare categories and how-many as category mode", () => {
    expect(isCategoryBrowseQuery("boxing gloves")).toBe(true);
    expect(isCategoryBrowseQuery("how many boxing gloves")).toBe(true);
    expect(isCategoryBrowseQuery("rash guards")).toBe(true);
    expect(resolveCatalogResponseMode("boxing gloves", "boxing gloves")).toBe(
      "category",
    );
    expect(
      resolveCatalogResponseMode("how many head guards", "head guards"),
    ).toBe("category");
  });

  it("treats explicit all/every as list mode", () => {
    expect(
      resolveCatalogResponseMode("Show all boxing gloves", "boxing gloves"),
    ).toBe("list");
    expect(
      resolveCatalogResponseMode("list every MMA glove", "mma gloves"),
    ).toBe("list");
  });

  it("treats named products as specific mode", () => {
    expect(
      resolveCatalogResponseMode(
        "Tell me about RDX T15",
        "RDX T15 Noir MMA Sparring Gloves 7oz",
      ),
    ).toBe("specific");
  });
});

describe("needsProductClarification", () => {
  it("flags ultra-broad shopping asks", () => {
    expect(needsProductClarification("gloves")).toBe(true);
    expect(needsProductClarification("I need gloves")).toBe(true);
    expect(needsProductClarification("I need protection")).toBe(true);
    expect(needsProductClarification("I need gym equipment")).toBe(true);
    expect(needsProductClarification("looking for gear")).toBe(true);
  });

  it("does not flag clearer category or product queries", () => {
    expect(needsProductClarification("boxing gloves")).toBe(false);
    expect(needsProductClarification("head guards")).toBe(false);
    expect(needsProductClarification("show me gloves")).toBe(false);
    expect(needsProductClarification("how many gloves")).toBe(false);
    expect(needsProductClarification("training gloves")).toBe(false);
  });
});

describe("shouldForceProductSearch", () => {
  it("forces search for product-like messages", () => {
    expect(shouldForceProductSearch("do you sell shin guards")).toBe(true);
    expect(shouldForceProductSearch("looking for kids punch bag")).toBe(true);
    expect(shouldForceProductSearch("robo kids punch")).toBe(true);
    expect(shouldForceProductSearch("RDX F6 Kara Boxing Training Gloves")).toBe(
      true
    );
    expect(shouldForceProductSearch("training boxing gloves")).toBe(true);
    expect(shouldForceProductSearch("how many products in sauna vests")).toBe(
      true
    );
  });

  it("forces search for clear category browse, not ultra-broad clarifies", () => {
    expect(shouldForceProductSearch("boxing gloves")).toBe(true);
    expect(shouldForceProductSearch("boxing")).toBe(true);
    expect(shouldForceProductSearch("head guards")).toBe(true);
    expect(shouldForceProductSearch("gloves")).toBe(false);
    expect(shouldForceProductSearch("I need gloves")).toBe(false);
    expect(shouldForceProductSearch("I need protection")).toBe(false);
    expect(shouldForceProductSearch("I need gym equipment")).toBe(false);
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

  it("does not force search for pure policy questions", () => {
    expect(shouldForceProductSearch("what is your return policy")).toBe(false);
    expect(shouldForceProductSearch("how long does shipping take")).toBe(false);
  });
});

// Safety classifier is currently commented out in lib/chat/intent/safety.ts.
describe.skip("isHarmfulQuery", () => {
  it("flags dangerous / illegal requests (incl. brand-name misuse)", () => {
    // expect(isHarmfulQuery("rdx bomb")).toBe(true);
  });

  it("does not flag legitimate product or shopping queries", () => {
    // expect(isHarmfulQuery("rdx boxing gloves")).toBe(false);
  });

  it("keeps harmful queries out of forced product search", () => {
    expect(shouldForceProductSearch("rdx bomb")).toBe(false);
    expect(shouldForceProductSearch("how to make a bomb")).toBe(false);
  });
});

describe("isOffTopicQuery", () => {
  it("detects trivia and general knowledge", () => {
    expect(isOffTopicQuery("what is the capital of germany")).toBe(true);
    expect(isOffTopicQuery("who is the president of france")).toBe(true);
  });

  it("does not flag shopping or policy questions", () => {
    expect(isOffTopicQuery("what is the price of boxing gloves")).toBe(false);
    expect(isOffTopicQuery("track this order")).toBe(false);
    expect(isOffTopicQuery("boxing gloves")).toBe(false);
    expect(isOffTopicQuery("what is your return policy")).toBe(false);
    expect(isOffTopicQuery("how many products in sauna vests")).toBe(false);
    expect(isOffTopicQuery("how many boxing gloves")).toBe(false);
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
    expect(isProductFollowUpQuery("what is the capital of germany")).toBe(false);
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
