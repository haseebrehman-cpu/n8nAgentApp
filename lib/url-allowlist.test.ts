import { describe, expect, it } from "vitest";
import { isAllowedChatHref } from "@/lib/url-allowlist";

describe("isAllowedChatHref", () => {
  it("blocks CDN and non-http", () => {
    expect(isAllowedChatHref("javascript:alert(1)")).toBe(false);
    expect(isAllowedChatHref("https://cdn.shopify.com/x.png")).toBe(false);
  });

  it("allows carriers and myshopify", () => {
    expect(isAllowedChatHref("https://www.dhl.com/track")).toBe(true);
    expect(isAllowedChatHref("https://store.myshopify.com/products/a")).toBe(
      true
    );
  });

  it("still blocks Shopify CDN for general chat links", () => {
    expect(
      isAllowedChatHref(
        "https://cdn.shopify.com/s/files/1/0000/0001/files/chart.png",
      ),
    ).toBe(false);
  });
});
