import { afterEach, describe, expect, it } from "vitest";
import {
  isAllowedSizeChartUrl,
  toShopifyProductGid,
} from "@/lib/shopify/size-chart-url";

describe("toShopifyProductGid", () => {
  it("normalizes gid and numeric ids", () => {
    expect(toShopifyProductGid("gid://shopify/Product/123")).toBe(
      "gid://shopify/Product/123",
    );
    expect(toShopifyProductGid("456")).toBe("gid://shopify/Product/456");
  });

  it("rejects invalid ids", () => {
    expect(toShopifyProductGid("")).toBeNull();
    expect(toShopifyProductGid("gid://shopify/ProductVariant/1")).toBeNull();
    expect(toShopifyProductGid("not-an-id")).toBeNull();
  });
});

describe("isAllowedSizeChartUrl", () => {
  const prevHost = process.env.NEXT_PUBLIC_STOREFRONT_HOST;

  afterEach(() => {
    if (prevHost === undefined) {
      delete process.env.NEXT_PUBLIC_STOREFRONT_HOST;
    } else {
      process.env.NEXT_PUBLIC_STOREFRONT_HOST = prevHost;
    }
  });

  it("allows storefront /cdn/shop/files/ images when host is configured", () => {
    process.env.NEXT_PUBLIC_STOREFRONT_HOST = "rdxsports.co.uk";
    expect(
      isAllowedSizeChartUrl(
        "https://rdxsports.co.uk/cdn/shop/files/BGR-AS2_Size_Chart_new.webp?v=1781166147",
      ),
    ).toBe(true);
  });

  it("allows Shopify global CDN file URLs", () => {
    expect(
      isAllowedSizeChartUrl(
        "https://cdn.shopify.com/s/files/1/0000/0001/files/chart.png?v=1",
      ),
    ).toBe(true);
  });

  it("rejects non-https, credentials, wrong paths, and non-images", () => {
    process.env.NEXT_PUBLIC_STOREFRONT_HOST = "rdxsports.co.uk";
    expect(
      isAllowedSizeChartUrl(
        "http://rdxsports.co.uk/cdn/shop/files/chart.webp",
      ),
    ).toBe(false);
    expect(
      isAllowedSizeChartUrl(
        "https://user:pass@rdxsports.co.uk/cdn/shop/files/chart.webp",
      ),
    ).toBe(false);
    expect(
      isAllowedSizeChartUrl("https://rdxsports.co.uk/products/boxing-gloves"),
    ).toBe(false);
    expect(
      isAllowedSizeChartUrl(
        "https://rdxsports.co.uk/cdn/shop/files/chart.pdf",
      ),
    ).toBe(false);
    expect(
      isAllowedSizeChartUrl("https://evil.example/cdn/shop/files/chart.webp"),
    ).toBe(false);
    expect(isAllowedSizeChartUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects storefront CDN when host is not configured", () => {
    delete process.env.NEXT_PUBLIC_STOREFRONT_HOST;
    expect(
      isAllowedSizeChartUrl(
        "https://rdxsports.co.uk/cdn/shop/files/chart.webp",
      ),
    ).toBe(false);
  });
});
