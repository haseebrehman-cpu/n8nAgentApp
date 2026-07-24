import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shopify/storefront-mcp", () => ({
  searchCatalog: vi.fn(),
  getProduct: vi.fn(),
  lookupCatalog: vi.fn(),
  searchShopPoliciesAndFaqs: vi.fn(),
}));

vi.mock("@/lib/shopify/storefront-collection", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/shopify/storefront-collection")
  >("@/lib/shopify/storefront-collection");
  return {
    ...actual,
    fetchStorefrontCollectionsMerged: vi.fn(),
    pickCategoryCollectionsFromMcpSearch: vi.fn(),
  };
});

vi.mock("@/lib/shopify/storefront-product-search", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/shopify/storefront-product-search")
  >("@/lib/shopify/storefront-product-search");
  return {
    ...actual,
    enrichSearchCatalogWithStorefront: vi.fn(
      async (raw: string) => raw,
    ),
  };
});

vi.mock("@/lib/chat/agent/catalog-count", () => ({
  searchCatalogForCount: vi.fn(),
}));

vi.mock("@/services/shopify/productInventory", () => ({
  fetchProductInventory: vi.fn(),
  fetchInventoryByIds: vi.fn(),
}));

vi.mock("@/services/shopify/productSizeChart", () => ({
  fetchProductSizeChart: vi.fn(),
}));

import { searchCatalog } from "@/lib/shopify/storefront-mcp";
import {
  fetchStorefrontCollectionsMerged,
  pickCategoryCollectionsFromMcpSearch,
} from "@/lib/shopify/storefront-collection";
import { searchCatalogForCount } from "@/lib/chat/agent/catalog-count";
import { fetchProductInventory } from "@/services/shopify/productInventory";
import { runTool } from "@/lib/chat/agent/tool-runner";
import { extractCatalogData } from "@/lib/chat/agent/mcp-format";

const mockedSearch = vi.mocked(searchCatalog);
const mockedPick = vi.mocked(pickCategoryCollectionsFromMcpSearch);
const mockedCollection = vi.mocked(fetchStorefrontCollectionsMerged);
const mockedCount = vi.mocked(searchCatalogForCount);
const mockedInventory = vi.mocked(fetchProductInventory);

function makeCollectionJson(count: number): string {
  return JSON.stringify({
    products: Array.from({ length: count }, (_, i) => ({
      id: `gid://shopify/Product/${i + 1}`,
      title: `Boxing Glove ${i + 1}`,
      url: `https://example.com/products/glove-${i + 1}`,
      price_range: { min: { amount: 2999, currency: "GBP" } },
      variants: [{ title: "Default", availability: { available: true } }],
    })),
    pagination: { has_next_page: false },
    collection: { title: "Boxing Gloves", handle: "boxing-gloves" },
  });
}

describe("runTool search_catalog modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSearch.mockResolvedValue(
      JSON.stringify({
        products: [],
        pagination: { has_next_page: false },
      }),
    );
    mockedPick.mockReturnValue([
      {
        handle: "boxing-gloves",
        title: "Boxing Gloves",
        score: 10,
        hitCount: 5,
      },
    ]);
    mockedCollection.mockResolvedValue(makeCollectionJson(17));
  });

  it("category browse returns exact total and caps products at 5", async () => {
    const result = await runTool(
      "search_catalog",
      { query: "boxing gloves" },
      { lastUser: "boxing gloves" },
    );
    const parsed = JSON.parse(extractCatalogData(result)!);
    expect(parsed.productCount).toBe(17);
    expect(parsed.products).toHaveLength(5);
    expect(parsed.productsTruncated).toBe(true);
    expect(parsed.countIsExactCategoryTotal).toBe(true);
    expect(result).toContain("CATEGORY MODE");
  });

  it("merges subcategory collections for parent category totals", async () => {
    mockedPick.mockReturnValue([
      {
        handle: "boxing-gloves-training",
        title: "Training Boxing Gloves",
        score: 140,
        hitCount: 4,
      },
      {
        handle: "boxing-gloves-competition",
        title: "Competition Boxing Gloves",
        score: 120,
        hitCount: 2,
      },
      {
        handle: "boxing-gloves-sparring",
        title: "Sparring Boxing Gloves",
        score: 110,
        hitCount: 1,
      },
      {
        handle: "boxing-gloves-bag-work",
        title: "Bag Work Boxing Gloves",
        score: 100,
        hitCount: 1,
      },
    ]);
    mockedCollection.mockResolvedValue(makeCollectionJson(55));

    const result = await runTool(
      "search_catalog",
      { query: "boxing gloves" },
      { lastUser: "list all products of boxing gloves" },
    );
    expect(mockedCollection).toHaveBeenCalledWith(
      [
        { handle: "boxing-gloves-training", title: "Training Boxing Gloves" },
        {
          handle: "boxing-gloves-competition",
          title: "Competition Boxing Gloves",
        },
        { handle: "boxing-gloves-sparring", title: "Sparring Boxing Gloves" },
        { handle: "boxing-gloves-bag-work", title: "Bag Work Boxing Gloves" },
      ],
      expect.objectContaining({ availableOnly: false }),
    );
    const parsed = JSON.parse(extractCatalogData(result)!);
    expect(parsed.productCount).toBe(55);
    expect(result).toContain("subcategory collections");
  });

  it("explicit list returns exact total and caps products at 20", async () => {
    mockedCollection.mockResolvedValue(makeCollectionJson(35));
    const result = await runTool(
      "search_catalog",
      { query: "boxing gloves" },
      { lastUser: "Show all boxing gloves" },
    );
    const parsed = JSON.parse(extractCatalogData(result)!);
    expect(parsed.productCount).toBe(35);
    expect(parsed.products).toHaveLength(20);
    expect(parsed.productsTruncated).toBe(true);
    expect(result).toContain("LIST MODE");
  });

  it("paginates MCP when no collection is found for category counts", async () => {
    mockedPick.mockReturnValue([]);
    mockedCount.mockResolvedValue({
      raw: makeCollectionJson(8),
      exhausted: true,
    });

    const result = await runTool(
      "search_catalog",
      { query: "boxing gloves", forCount: true },
      { lastUser: "how many boxing gloves" },
    );
    expect(mockedCount).toHaveBeenCalled();
    const parsed = JSON.parse(extractCatalogData(result)!);
    expect(parsed.productCount).toBe(8);
    expect(parsed.products.length).toBeLessThanOrEqual(5);
    expect(parsed.countIsExactCategoryTotal).toBe(true);
  });
});

describe("runTool get_inventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns Admin inventory for a product id", async () => {
    mockedInventory.mockResolvedValue({
      found: true,
      productId: "gid://shopify/Product/1",
      productTitle: "RDX T15",
      tracksInventory: true,
      totalInventory: 12,
      variants: [
        {
          id: "gid://shopify/ProductVariant/9",
          title: "Red / 7oz",
          sku: "T15-R",
          options: [
            { name: "Color", value: "Red" },
            { name: "Weight", value: "7oz" },
          ],
          inventoryQuantity: 12,
        },
      ],
    });

    const result = JSON.parse(
      await runTool(
        "get_inventory",
        { id: "gid://shopify/Product/1" },
        {},
      ),
    );
    expect(result.found).toBe(true);
    expect(result.totalInventory).toBe(12);
    expect(result.hint).toMatch(/exact quantities/i);
  });

  it("requires id or ids", async () => {
    const result = JSON.parse(await runTool("get_inventory", {}, {}));
    expect(result.error).toMatch(/id or ids/i);
  });
});
