import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shopify/storefront-collection", () => ({
  storefrontCatalogOrigin: () => "https://rdxsports.co.uk",
}));

vi.mock("@/lib/shopify/storefront-mcp", () => ({
  lookupCatalog: vi.fn(),
}));

import { lookupCatalog } from "@/lib/shopify/storefront-mcp";
import {
  enrichSearchCatalogWithStorefront,
  hasStrongTitleMatch,
  isProductSpecificQuery,
} from "@/lib/shopify/storefront-product-search";

const mockedLookup = vi.mocked(lookupCatalog);

describe("isProductSpecificQuery", () => {
  it("detects model tokens and long product titles", () => {
    expect(isProductSpecificQuery("RDX T15 Noir MMA Sparring Gloves 7oz")).toBe(
      true,
    );
    expect(isProductSpecificQuery("F6 kara gloves")).toBe(true);
    expect(isProductSpecificQuery("mma sparring gloves")).toBe(false);
  });
});

describe("hasStrongTitleMatch", () => {
  it("matches exact titles and all-term titles", () => {
    expect(
      hasStrongTitleMatch(
        "RDX T15 Noir MMA Sparring Gloves 7oz",
        "RDX T15 Noir MMA Sparring Gloves 7oz",
      ),
    ).toBe(true);
    expect(
      hasStrongTitleMatch(
        "RDX T15 Noir MMA Sparring Gloves",
        "RDX T15 Noir MMA Sparring Gloves 7oz",
      ),
    ).toBe(false);
  });
});

describe("enrichSearchCatalogWithStorefront", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mockedLookup.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prepends an exact storefront title MCP missed", async () => {
    const mcpRaw = JSON.stringify({
      products: [
        {
          id: "gid://shopify/Product/8665996820790",
          title: "RDX T15 Noir MMA Sparring Gloves",
        },
        {
          id: "gid://shopify/Product/8670905827638",
          title: "RDX T6 MMA Sparring Gloves 7oz",
        },
      ],
    });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        resources: {
          results: {
            products: [
              {
                id: 9413912035638,
                title: "RDX T15 Noir MMA Sparring Gloves 7oz",
                handle: "t15-noir-mma-sparring-gloves-7oz",
                url: "/products/t15-noir-mma-sparring-gloves-7oz",
              },
            ],
          },
        },
      }),
    });

    mockedLookup.mockResolvedValue(
      JSON.stringify({
        products: [
          {
            id: "gid://shopify/Product/9413912035638",
            title: "RDX T15 Noir MMA Sparring Gloves 7oz",
            variants: [{ title: "Black / S", availability: { available: true } }],
          },
        ],
      }),
    );

    const enriched = await enrichSearchCatalogWithStorefront(
      mcpRaw,
      "RDX T15 Noir MMA Sparring Gloves 7oz",
    );
    const parsed = JSON.parse(enriched);

    expect(mockedLookup).toHaveBeenCalledWith(
      { ids: ["gid://shopify/Product/9413912035638"] },
      expect.anything(),
    );
    expect(parsed.products[0].title).toBe(
      "RDX T15 Noir MMA Sparring Gloves 7oz",
    );
    expect(parsed.products).toHaveLength(3);
  });

  it("skips enrich when MCP already has a strong title match", async () => {
    const mcpRaw = JSON.stringify({
      products: [
        {
          id: "gid://shopify/Product/9413912035638",
          title: "RDX T15 Noir MMA Sparring Gloves 7oz",
        },
      ],
    });

    const enriched = await enrichSearchCatalogWithStorefront(
      mcpRaw,
      "RDX T15 Noir MMA Sparring Gloves 7oz",
    );

    expect(enriched).toBe(mcpRaw);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("skips enrich for broad category queries", async () => {
    const mcpRaw = JSON.stringify({
      products: [
        { id: "gid://shopify/Product/1", title: "RDX T6 MMA Sparring Gloves" },
      ],
    });

    const enriched = await enrichSearchCatalogWithStorefront(
      mcpRaw,
      "mma sparring gloves",
    );

    expect(enriched).toBe(mcpRaw);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it("keeps MCP JSON when storefront suggest fails", async () => {
    const mcpRaw = JSON.stringify({
      products: [
        {
          id: "gid://shopify/Product/8665996820790",
          title: "RDX T15 Noir MMA Sparring Gloves",
        },
      ],
    });

    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const enriched = await enrichSearchCatalogWithStorefront(
      mcpRaw,
      "RDX T15 Noir MMA Sparring Gloves 7oz",
    );

    expect(enriched).toBe(mcpRaw);
    expect(mockedLookup).not.toHaveBeenCalled();
  });
});
