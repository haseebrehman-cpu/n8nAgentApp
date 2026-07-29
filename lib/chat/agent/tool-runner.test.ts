import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/search", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat/search")>(
    "@/lib/chat/search",
  );
  return {
    ...actual,
    executeSemanticSearch: vi.fn(),
  };
});

vi.mock("@/lib/shopify/storefront-mcp", () => ({
  searchCatalog: vi.fn(),
  getProduct: vi.fn(),
  lookupCatalog: vi.fn(),
  searchShopPoliciesAndFaqs: vi.fn(),
}));

vi.mock("@/services/shopify/productInventory", () => ({
  fetchProductInventory: vi.fn(),
  fetchInventoryByIds: vi.fn(),
}));

vi.mock("@/services/shopify/productSizeChart", () => ({
  fetchProductSizeChart: vi.fn(),
}));

import { getProduct } from "@/lib/shopify/storefront-mcp";
import { fetchProductInventory } from "@/services/shopify/productInventory";
import { executeSemanticSearch } from "@/lib/chat/search";
import { runTool } from "@/lib/chat/agent/tool-runner";
import { extractCatalogData } from "@/lib/chat/agent/mcp-format";
import {
  CATEGORY_PAYLOAD_PRODUCTS,
  LIST_PAYLOAD_PRODUCTS,
} from "@/lib/chat/agent/config";

const mockedSearch = vi.mocked(executeSemanticSearch);
const mockedGetProduct = vi.mocked(getProduct);
const mockedInventory = vi.mocked(fetchProductInventory);

describe("runTool search_catalog modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps semantic search results in CATEGORY MODE", async () => {
    mockedSearch.mockResolvedValue({
      compactJson: JSON.stringify({
        productCount: 17,
        products: Array.from({ length: CATEGORY_PAYLOAD_PRODUCTS }, (_, i) => ({
          id: `gid://shopify/Product/${i + 1}`,
          title: `Boxing Glove ${i + 1}`,
        })),
        productsTruncated: true,
        countIsExactCategoryTotal: true,
      }),
      effectiveQuery: "boxing gloves",
      originalQuery: "boxing gloves",
      mode: "category",
      confidence: "high",
      productCount: 17,
      fallbackApplied: false,
      reusedContext: false,
      collectionLabel: '"Boxing Gloves" (boxing-gloves)',
    });

    const onSearchQuery = vi.fn();
    const result = await runTool(
      "search_catalog",
      { query: "boxing gloves" },
      { lastUser: "boxing gloves", onSearchQuery },
    );
    const parsed = JSON.parse(extractCatalogData(result)!);
    expect(parsed.productCount).toBe(17);
    expect(parsed.products).toHaveLength(CATEGORY_PAYLOAD_PRODUCTS);
    expect(result).toContain("CATEGORY MODE");
    expect(onSearchQuery).toHaveBeenCalledWith("boxing gloves");
  });

  it("wraps list mode with list payload cap hint", async () => {
    mockedSearch.mockResolvedValue({
      compactJson: JSON.stringify({
        productCount: 35,
        products: Array.from({ length: LIST_PAYLOAD_PRODUCTS }, (_, i) => ({
          id: `gid://${i}`,
          title: `G${i}`,
        })),
        productsTruncated: true,
        countIsExactCategoryTotal: true,
      }),
      effectiveQuery: "boxing gloves",
      originalQuery: "boxing gloves",
      mode: "list",
      confidence: "high",
      productCount: 35,
      fallbackApplied: false,
      reusedContext: false,
      collectionLabel: '"Boxing Gloves" (boxing-gloves)',
    });

    const result = await runTool(
      "search_catalog",
      { query: "boxing gloves" },
      { lastUser: "Show all boxing gloves" },
    );
    expect(result).toContain("LIST MODE");
    expect(result).toContain(String(LIST_PAYLOAD_PRODUCTS));
  });

  it("defaults to in-stock results for ordinary browse queries", async () => {
    mockedSearch.mockResolvedValue({
      compactJson: JSON.stringify({
        productCount: 1,
        products: [{ id: "1", title: "Punch Paddles" }],
      }),
      effectiveQuery: "punch paddles",
      originalQuery: "punch paddles",
      mode: "generic",
      confidence: "high",
      productCount: 1,
      fallbackApplied: false,
      reusedContext: false,
    });

    await runTool("search_catalog", { query: "punch paddles" }, {
      lastUser: "How much do punch paddles cost",
    });

    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "punch paddles",
        availableOnly: true,
      }),
    );
  });

  it("passes session search context into the orchestrator", async () => {
    mockedSearch.mockResolvedValue({
      compactJson: JSON.stringify({
        productCount: 1,
        products: [{ id: "1", title: "Blue Glove" }],
        reusedContext: true,
      }),
      effectiveQuery: "blue sparring gloves",
      originalQuery: "blue sparring gloves",
      mode: "generic",
      confidence: "partial",
      productCount: 1,
      fallbackApplied: false,
      reusedContext: true,
    });

    await runTool(
      "search_catalog",
      { query: "blue" },
      {
        lastUser: "only blue ones",
        lastSearchQuery: "sparring gloves",
        lastShownProducts: [
          {
            id: "1",
            title: "Blue Sparring Gloves",
            price: "£10",
            wasPrice: null,
            url: null,
            inStock: true,
            onSale: false,
          },
        ],
      },
    );

    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        lastUser: "only blue ones",
        lastSearchQuery: "sparring gloves",
        query: "blue",
      }),
    );
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

describe("runTool get_product", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tells the model to search when the id is not found", async () => {
    mockedGetProduct.mockRejectedValue(
      new Error(
        'Shopify MCP tool "get_product" returned an error: {"messages":[{"code":"product_not_found"}]}',
      ),
    );

    const result = JSON.parse(
      await runTool(
        "get_product",
        { id: "gid://shopify/Product/999" },
        {},
      ),
    );

    expect(result.error).toBe("product_not_found");
    expect(result.message).toMatch(/search_catalog/i);
    expect(result.message).toMatch(/Do NOT invent/i);
  });
});
