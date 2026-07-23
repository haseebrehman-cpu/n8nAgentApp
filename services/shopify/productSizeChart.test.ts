import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shopify/admin-client", () => ({
  shopifyAdminGraphql: vi.fn(),
}));

vi.mock("@/services/shopify/credentials", () => ({
  resolveShopifyStore: () => ({
    region: "default",
    domain: "test.myshopify.com",
    accessToken: "token",
    apiVersion: "2025-07",
  }),
}));

import { shopifyAdminGraphql } from "@/lib/shopify/admin-client";
import { fetchProductSizeChart } from "@/services/shopify/productSizeChart";

const mockedGraphql = vi.mocked(shopifyAdminGraphql);

describe("fetchProductSizeChart", () => {
  const prevHost = process.env.NEXT_PUBLIC_STOREFRONT_HOST;
  const prevKey = process.env.SHOPIFY_SIZE_CHART_METAFIELD_KEY;

  beforeEach(() => {
    mockedGraphql.mockReset();
    process.env.NEXT_PUBLIC_STOREFRONT_HOST = "rdxsports.co.uk";
    delete process.env.SHOPIFY_SIZE_CHART_METAFIELD_KEY;
  });

  afterEach(() => {
    if (prevHost === undefined) {
      delete process.env.NEXT_PUBLIC_STOREFRONT_HOST;
    } else {
      process.env.NEXT_PUBLIC_STOREFRONT_HOST = prevHost;
    }
    if (prevKey === undefined) {
      delete process.env.SHOPIFY_SIZE_CHART_METAFIELD_KEY;
    } else {
      process.env.SHOPIFY_SIZE_CHART_METAFIELD_KEY = prevKey;
    }
  });

  it("returns a verified MediaImage chart from custom.sizeguide", async () => {
    mockedGraphql.mockResolvedValue({
      product: {
        id: "gid://shopify/Product/1",
        title: "RDX F7 Ego Boxing Gloves",
        sizeguide: {
          type: "file_reference",
          value: "gid://shopify/MediaImage/36283220295990",
          reference: {
            image: {
              url: "https://cdn.shopify.com/s/files/1/0813/3027/4614/files/BGL-PFA2_1.jpg?v=1696854530",
              altText: "",
              width: 700,
              height: 700,
            },
          },
        },
        size_chart: null,
        size_guide: null,
      },
    });

    const chart = await fetchProductSizeChart("gid://shopify/Product/1");
    expect(chart).toEqual({
      productId: "gid://shopify/Product/1",
      productTitle: "RDX F7 Ego Boxing Gloves",
      url: "https://cdn.shopify.com/s/files/1/0813/3027/4614/files/BGL-PFA2_1.jpg?v=1696854530",
      altText: "Size chart for RDX F7 Ego Boxing Gloves",
      width: 700,
      height: 700,
    });
  });

  it("falls back to size_chart when sizeguide is empty", async () => {
    mockedGraphql.mockResolvedValue({
      product: {
        id: "gid://shopify/Product/2",
        title: "AS2 Gloves",
        sizeguide: null,
        size_chart: {
          type: "file_reference",
          value: "gid://shopify/MediaImage/1",
          reference: {
            image: {
              url: "https://rdxsports.co.uk/cdn/shop/files/BGR-AS2_Size_Chart_new.webp?v=1",
              altText: "AS2 chart",
              width: 1000,
              height: 800,
            },
          },
        },
        size_guide: null,
      },
    });

    const chart = await fetchProductSizeChart("gid://shopify/Product/2");
    expect(chart?.url).toContain("BGR-AS2");
  });

  it("returns null when metafield URL is not allowlisted", async () => {
    mockedGraphql.mockResolvedValue({
      product: {
        id: "gid://shopify/Product/1",
        title: "Gloves",
        sizeguide: {
          type: "url",
          value: "https://evil.example/chart.webp",
          reference: null,
        },
        size_chart: null,
        size_guide: null,
      },
    });

    await expect(fetchProductSizeChart("1")).resolves.toBeNull();
  });

  it("returns null when product or metafield is missing", async () => {
    mockedGraphql.mockResolvedValue({ product: null });
    await expect(
      fetchProductSizeChart("gid://shopify/Product/9"),
    ).resolves.toBeNull();

    mockedGraphql.mockResolvedValue({
      product: {
        id: "gid://shopify/Product/9",
        title: "No chart",
        sizeguide: null,
        size_chart: null,
        size_guide: null,
      },
    });
    await expect(
      fetchProductSizeChart("gid://shopify/Product/9"),
    ).resolves.toBeNull();
  });

  it("rejects invalid product ids without calling Shopify", async () => {
    await expect(fetchProductSizeChart("not-valid")).resolves.toBeNull();
    expect(mockedGraphql).not.toHaveBeenCalled();
  });
});
