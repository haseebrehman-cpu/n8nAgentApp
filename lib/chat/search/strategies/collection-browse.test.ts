import { describe, expect, it, vi } from "vitest";
import { collectionBrowseStrategy } from "@/lib/chat/search/strategies/collection-browse";
import type {
  StrategyDeps,
  StrategyRequest,
} from "@/lib/chat/search/strategies/types";
import type { ICollectionRepository } from "@/lib/chat/repositories/types";

function requestWith(
  primary: { handle: string; title: string; department?: string },
  children: Array<{ handle: string; title: string; department?: string }>,
): StrategyRequest {
  return {
    message: "how many plain yoga straps available",
    canonicalSearch: "basic yoga strap",
    filters: {},
    categoryMatch: {
      primary: {
        ...primary,
        productsCount: 1,
        score: 100,
      },
      children: children.map((c) => ({
        ...c,
        productsCount: 10,
        score: 50,
      })),
      needsClarification: false,
    },
  };
}

describe("collectionBrowseStrategy handle selection", () => {
  it("loads only primary + nested children, not same-department siblings", async () => {
    const fetchCollectionProducts = vi.fn(async (handles: string[]) => ({
      products: handles.map((h, i) => ({
        id: `gid://shopify/Product/${i + 1}`,
        title: `Product ${h}`,
        url: `https://example.com/products/${h}`,
        collections: [h],
      })),
      collection: { handle: handles[0]!, title: handles[0]!, productsCount: 1 },
      totalCount: handles.length,
    }));

    const deps: StrategyDeps = {
      catalogRepo: {} as StrategyDeps["catalogRepo"],
      collectionRepo: {
        listCollections: vi.fn(),
        fetchCollectionProducts,
      } as unknown as ICollectionRepository,
    };

    const result = await collectionBrowseStrategy.execute(
      requestWith(
        { handle: "yoga-strap-plain", title: "Plain", department: "yoga" },
        [
          { handle: "yoga-strap", title: "Yoga Strap", department: "yoga" },
          {
            handle: "yoga-strap-color-straps",
            title: "Color Straps",
            department: "yoga",
          },
          { handle: "yoga", title: "Yoga", department: "yoga" },
          { handle: "balls", title: "Balls", department: "yoga" },
          {
            handle: "yoga-strap-plain-cotton",
            title: "Cotton Plain",
            department: "yoga",
          },
        ],
      ),
      deps,
    );

    expect(fetchCollectionProducts).toHaveBeenCalledWith(
      ["yoga-strap-plain", "yoga-strap-plain-cotton"],
      expect.any(Object),
    );
    expect(result?.totalCount).toBe(2);
    expect(result?.collectionHandle).toBe("yoga-strap-plain");
  });

  it("still nests real children under a parent category", async () => {
    const fetchCollectionProducts = vi.fn(async (handles: string[]) => ({
      products: handles.map((h, i) => ({
        id: `gid://shopify/Product/${i + 1}`,
        title: `Product ${h}`,
        collections: [h],
      })),
      collection: { handle: handles[0]!, title: handles[0]!, productsCount: 1 },
      totalCount: handles.length,
    }));

    const deps: StrategyDeps = {
      catalogRepo: {} as StrategyDeps["catalogRepo"],
      collectionRepo: {
        listCollections: vi.fn(),
        fetchCollectionProducts,
      } as unknown as ICollectionRepository,
    };

    await collectionBrowseStrategy.execute(
      requestWith(
        { handle: "yoga-strap", title: "Yoga Strap", department: "yoga" },
        [
          { handle: "yoga-strap-plain", title: "Plain", department: "yoga" },
          {
            handle: "yoga-strap-color-straps",
            title: "Color Straps",
            department: "yoga",
          },
          { handle: "yoga", title: "Yoga", department: "yoga" },
        ],
      ),
      deps,
    );

    expect(fetchCollectionProducts).toHaveBeenCalledWith(
      ["yoga-strap", "yoga-strap-plain", "yoga-strap-color-straps"],
      expect.any(Object),
    );
  });
});
