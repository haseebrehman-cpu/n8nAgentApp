import { describe, expect, it } from "vitest";
import {
  parseCatalogGid,
  toShopifyProductGid,
  toShopifyVariantGid,
} from "@/lib/shopify/gid";

describe("gid helpers", () => {
  it("normalizes product gids and numeric ids", () => {
    expect(toShopifyProductGid("gid://shopify/Product/123")).toBe(
      "gid://shopify/Product/123",
    );
    expect(toShopifyProductGid("456")).toBe("gid://shopify/Product/456");
    expect(toShopifyProductGid("gid://shopify/ProductVariant/1")).toBeNull();
  });

  it("normalizes variant gids only", () => {
    expect(toShopifyVariantGid("gid://shopify/ProductVariant/9")).toBe(
      "gid://shopify/ProductVariant/9",
    );
    expect(toShopifyVariantGid("9")).toBeNull();
  });

  it("parses product vs variant", () => {
    expect(parseCatalogGid("gid://shopify/Product/1")).toEqual({
      kind: "product",
      gid: "gid://shopify/Product/1",
    });
    expect(parseCatalogGid("gid://shopify/ProductVariant/2")).toEqual({
      kind: "variant",
      gid: "gid://shopify/ProductVariant/2",
    });
    expect(parseCatalogGid("nope")).toBeNull();
  });
});
