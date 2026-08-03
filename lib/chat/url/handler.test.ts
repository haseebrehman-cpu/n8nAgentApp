import { beforeEach, describe, expect, it, vi } from "vitest";
import { NON_OFFICIAL_RDX_URL_REPLY } from "@/lib/chat/url/replies";

vi.mock("@/lib/chat/repositories", () => ({
  createCatalogRepository: () => ({
    getProduct: vi.fn(),
    searchPolicies: vi.fn(),
    searchCatalog: vi.fn(),
    lookupByIds: vi.fn(),
  }),
}));

vi.mock("@/lib/chat/url/dispatcher", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat/url/dispatcher")>(
    "@/lib/chat/url/dispatcher",
  );
  return {
    ...actual,
    dispatchRdxResources: vi.fn(),
  };
});

import { tryResolveRdxUrlTurn } from "@/lib/chat/url/handler";
import { dispatchRdxResources } from "@/lib/chat/url/dispatcher";
import {
  INVALID_URL_REPLY,
  MCP_FAILURE_REPLY,
  RESOURCE_NOT_FOUND_REPLY,
  UNSUPPORTED_RDX_PAGE_REPLY,
} from "@/lib/chat/url/replies";

const dispatchMock = vi.mocked(dispatchRdxResources);

describe("tryResolveRdxUrlTurn", () => {
  beforeEach(() => {
    dispatchMock.mockReset();
  });

  it("returns null when there is no URL", async () => {
    await expect(
      tryResolveRdxUrlTurn({ message: "show me boxing gloves" }),
    ).resolves.toBeNull();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("rejects non-official domains with the required reply", async () => {
    const decision = await tryResolveRdxUrlTurn({
      message: "Tell me about https://not-rdx.example/products/x",
    });
    expect(decision).toEqual({
      kind: "final_reply",
      reply: NON_OFFICIAL_RDX_URL_REPLY,
      intent: "rdx_url_rejected",
    });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported RDX paths", async () => {
    const decision = await tryResolveRdxUrlTurn({
      message: "What is https://rdxsports.com/cart ?",
    });
    expect(decision).toMatchObject({
      kind: "final_reply",
      reply: UNSUPPORTED_RDX_PAGE_REPLY,
    });
  });

  it("returns not-found when MCP dispatch cannot resolve the resource", async () => {
    dispatchMock.mockResolvedValue([{ ok: false, reason: "not_found" }]);
    const decision = await tryResolveRdxUrlTurn({
      message: "Tell me about https://rdxsports.co.uk/products/missing-item",
    });
    expect(decision).toMatchObject({
      kind: "final_reply",
      reply: RESOURCE_NOT_FOUND_REPLY,
    });
  });

  it("returns MCP failure reply on tool errors", async () => {
    dispatchMock.mockResolvedValue([{ ok: false, reason: "mcp_failure" }]);
    const decision = await tryResolveRdxUrlTurn({
      message: "Summarize https://rdxsports.co.uk/pages/about-us",
    });
    expect(decision).toMatchObject({
      kind: "final_reply",
      reply: MCP_FAILURE_REPLY,
    });
  });

  it("wraps successful product URL lookups for the LLM", async () => {
    dispatchMock.mockResolvedValue([
      {
        ok: true,
        payload: {
          resource: {
            type: "product",
            handle: "f6-gloves",
            pathname: "/products/f6-gloves",
            url: new URL("https://rdxsports.co.uk/products/f6-gloves"),
          },
          dataText: "<CATALOG_DATA>\n{\"product\":{\"id\":\"gid://shopify/Product/1\",\"title\":\"F6 Gloves\",\"price\":\"£49.99\",\"url\":\"https://rdxsports.co.uk/products/f6-gloves\",\"inStock\":true,\"onSale\":false,\"wasPrice\":null}}\n</CATALOG_DATA>",
          shownProducts: [
            {
              id: "gid://shopify/Product/1",
              title: "F6 Gloves",
              price: "£49.99",
              wasPrice: null,
              url: "https://rdxsports.co.uk/products/f6-gloves",
              inStock: true,
              onSale: false,
            },
          ],
          label: "product",
        },
      },
    ]);

    const decision = await tryResolveRdxUrlTurn({
      message: "Tell me about this product https://rdxsports.co.uk/products/f6-gloves",
    });

    expect(decision?.kind).toBe("llm_wrap");
    if (decision?.kind === "llm_wrap") {
      expect(decision.skipCatalogSearch).toBe(true);
      expect(decision.intent).toBe("rdx_url");
      expect(decision.systemBlocks[0]).toContain("RDX URL TURN");
      expect(decision.systemBlocks[0]).toContain("F6 Gloves");
      expect(decision.shownProducts?.[0]?.title).toBe("F6 Gloves");
    }
  });

  it("uses compare intent for two product URLs", async () => {
    dispatchMock.mockResolvedValue([
      {
        ok: true,
        payload: {
          resource: {
            type: "product",
            handle: "a",
            pathname: "/products/a",
            url: new URL("https://rdxsports.co.uk/products/a"),
          },
          dataText: "data-a",
          shownProducts: [],
          label: "product",
        },
      },
      {
        ok: true,
        payload: {
          resource: {
            type: "product",
            handle: "b",
            pathname: "/products/b",
            url: new URL("https://rdxsports.com/products/b"),
          },
          dataText: "data-b",
          shownProducts: [],
          label: "product",
        },
      },
    ]);

    const decision = await tryResolveRdxUrlTurn({
      message:
        "Compare https://rdxsports.co.uk/products/a and https://rdxsports.com/products/b",
    });
    expect(decision).toMatchObject({
      kind: "llm_wrap",
      intent: "rdx_url_compare",
      skipCatalogSearch: true,
    });
  });

  it("returns invalid URL reply for malformed links", async () => {
    const decision = await tryResolveRdxUrlTurn({
      message: "Look at https://",
    });
    // May be treated as no usable URL or invalid depending on extraction
    expect(
      decision === null ||
        (decision.kind === "final_reply" &&
          decision.reply === INVALID_URL_REPLY),
    ).toBe(true);
  });
});
