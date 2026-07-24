import { beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  fetchInventoryByIds,
  fetchProductInventory,
} from "@/services/shopify/productInventory";

const mockedGraphql = vi.mocked(shopifyAdminGraphql);

describe("fetchProductInventory", () => {
  beforeEach(() => {
    mockedGraphql.mockReset();
  });

  it("returns null for invalid ids", async () => {
    expect(await fetchProductInventory("not-a-gid")).toBeNull();
    expect(mockedGraphql).not.toHaveBeenCalled();
  });

  it("returns product total and variant quantities", async () => {
    mockedGraphql.mockResolvedValue({
      product: {
        id: "gid://shopify/Product/1",
        title: "RDX T15",
        totalInventory: 15,
        tracksInventory: true,
        variants: {
          nodes: [
            {
              id: "gid://shopify/ProductVariant/10",
              title: "Red / 7oz",
              sku: "T15",
              inventoryQuantity: 15,
              selectedOptions: [
                { name: "Color", value: "Red" },
                { name: "Weight", value: "7oz" },
              ],
            },
          ],
        },
      },
    });

    const result = await fetchProductInventory("gid://shopify/Product/1");
    expect(result).toMatchObject({
      found: true,
      productTitle: "RDX T15",
      tracksInventory: true,
      totalInventory: 15,
    });
    expect(result?.variants[0]?.inventoryQuantity).toBe(15);
  });

  it("reports zero inventory distinctly", async () => {
    mockedGraphql.mockResolvedValue({
      product: {
        id: "gid://shopify/Product/2",
        title: "Out of stock glove",
        totalInventory: 0,
        tracksInventory: true,
        variants: {
          nodes: [
            {
              id: "gid://shopify/ProductVariant/11",
              title: "Default",
              sku: null,
              inventoryQuantity: 0,
              selectedOptions: [],
            },
          ],
        },
      },
    });

    const result = await fetchProductInventory("2");
    expect(result?.found).toBe(true);
    expect(result?.totalInventory).toBe(0);
    expect(result?.variants[0]?.inventoryQuantity).toBe(0);
  });

  it("does not invent quantities when inventory is not tracked", async () => {
    mockedGraphql.mockResolvedValue({
      product: {
        id: "gid://shopify/Product/3",
        title: "Untracked",
        totalInventory: 99,
        tracksInventory: false,
        variants: {
          nodes: [
            {
              id: "gid://shopify/ProductVariant/12",
              title: "Default",
              sku: null,
              inventoryQuantity: 99,
              selectedOptions: [],
            },
          ],
        },
      },
    });

    const result = await fetchProductInventory("gid://shopify/Product/3");
    expect(result?.tracksInventory).toBe(false);
    expect(result?.totalInventory).toBeNull();
    expect(result?.variants[0]?.inventoryQuantity).toBeNull();
    expect(result?.message).toMatch(/does not track/i);
  });

  it("returns found:false when the product is missing", async () => {
    mockedGraphql.mockResolvedValue({ product: null });
    const result = await fetchProductInventory("gid://shopify/Product/404");
    expect(result?.found).toBe(false);
  });

  it("resolves a variant GID to that variant's quantity", async () => {
    mockedGraphql.mockResolvedValue({
      productVariant: {
        id: "gid://shopify/ProductVariant/20",
        title: "Blue / 14oz",
        sku: "B14",
        inventoryQuantity: 4,
        selectedOptions: [
          { name: "Color", value: "Blue" },
          { name: "Weight", value: "14oz" },
        ],
        product: {
          id: "gid://shopify/Product/5",
          title: "RDX F6",
          totalInventory: 40,
          tracksInventory: true,
        },
      },
    });

    const result = await fetchProductInventory(
      "gid://shopify/ProductVariant/20",
    );
    expect(result?.found).toBe(true);
    expect(result?.variantId).toBe("gid://shopify/ProductVariant/20");
    expect(result?.totalInventory).toBe(4);
    expect(result?.variants).toHaveLength(1);
    expect(result?.variants[0]?.inventoryQuantity).toBe(4);
  });
});

describe("fetchInventoryByIds", () => {
  beforeEach(() => {
    mockedGraphql.mockReset();
  });

  it("batches mixed product and variant ids", async () => {
    mockedGraphql.mockResolvedValue({
      nodes: [
        {
          __typename: "Product",
          id: "gid://shopify/Product/1",
          title: "Product A",
          totalInventory: 3,
          tracksInventory: true,
          variants: { nodes: [] },
        },
        {
          __typename: "ProductVariant",
          id: "gid://shopify/ProductVariant/9",
          title: "Var",
          sku: null,
          inventoryQuantity: 2,
          selectedOptions: [],
          product: {
            id: "gid://shopify/Product/2",
            title: "Product B",
            totalInventory: 10,
            tracksInventory: true,
          },
        },
      ],
    });

    const results = await fetchInventoryByIds([
      "gid://shopify/Product/1",
      "gid://shopify/ProductVariant/9",
      "bad",
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]?.totalInventory).toBe(3);
    expect(results[1]?.totalInventory).toBe(2);
  });
});
