import { describe, expect, it } from "vitest";
import {
  extractOrderLookupToken,
  hasRecentProductContext,
  isBareOrderNumberToken,
  isDiscountCodeQuery,
  isOffTopicQuery,
  isOrderTrackingIntent,
  isProductFollowUpQuery,
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

describe("shouldForceProductSearch", () => {
  it("forces search for product-like messages", () => {
    expect(shouldForceProductSearch("do you sell shin guards")).toBe(true);
    expect(shouldForceProductSearch("looking for kids punch bag")).toBe(true);
    expect(shouldForceProductSearch("robo kids punch")).toBe(true);
    expect(shouldForceProductSearch("RDX F6 Kara Boxing Training Gloves")).toBe(
      true
    );
    expect(shouldForceProductSearch("boxing gloves")).toBe(true);
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
