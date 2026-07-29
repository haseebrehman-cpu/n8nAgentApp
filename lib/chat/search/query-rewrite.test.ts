import { describe, expect, it } from "vitest";
import {
  buildFallbackQueries,
  focusPrimaryProductQuery,
  isSearchRefinement,
  mergeRefinementIntoQuery,
  normalizeSemanticQuery,
  rewriteSearchQuery,
} from "@/lib/chat/search/query-rewrite";
import {
  filterProductsByQueryRelevance,
  rankProductsByRelevance,
} from "@/lib/shopify/compact-catalog";

describe("normalizeSemanticQuery", () => {
  it("fixes common typos and headgear synonym", () => {
    expect(normalizeSemanticQuery("bosing glovs")).toMatch(/boxing/i);
    expect(normalizeSemanticQuery("boxing headgear")).toMatch(/head guards/i);
  });
});

describe("isSearchRefinement / mergeRefinementIntoQuery", () => {
  it("detects short colour refinements when prior search exists", () => {
    expect(isSearchRefinement("only blue ones", "sparring gloves")).toBe(true);
    expect(isSearchRefinement("16 oz", "boxing gloves")).toBe(true);
    expect(isSearchRefinement("show me boxing gloves", "sparring gloves")).toBe(
      false,
    );
  });

  it("merges refinement into prior query", () => {
    const merged = mergeRefinementIntoQuery("only blue ones", "sparring gloves");
    expect(merged.toLowerCase()).toContain("blue");
    expect(merged.toLowerCase()).toContain("sparring");
    expect(merged.toLowerCase()).toContain("glove");
  });
});

describe("rewriteSearchQuery", () => {
  it("merges follow-up refinements with lastSearchQuery", () => {
    const { query, mergedFromContext } = rewriteSearchQuery({
      toolQuery: "blue",
      lastUser: "only blue ones",
      lastSearchQuery: "sparring gloves",
    });
    expect(mergedFromContext).toBe(true);
    expect(query.toLowerCase()).toContain("blue");
    expect(query.toLowerCase()).toContain("sparring");
  });
});

describe("buildFallbackQueries", () => {
  it("strips budget and colour progressively", () => {
    const variants = buildFallbackQueries(
      "pink leather sparring gloves under £40",
    );
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.some((v) => !/£|40/.test(v))).toBe(true);
  });
});

describe("focusPrimaryProductQuery / kit asks", () => {
  const kit =
    "I need boxing gloves for sparring with leather construction, under £50, with matching wraps, head guard, mouth guard, shin guards and gym bag";

  it("strips accessories and keeps gloves as the search target", () => {
    const focused = focusPrimaryProductQuery(kit);
    expect(focused.toLowerCase()).toMatch(/glove/);
    expect(focused.toLowerCase()).not.toMatch(/head\s*guard/);
    expect(focused.toLowerCase()).not.toMatch(/\bwrap/);
    expect(focused.toLowerCase()).not.toMatch(/gym\s*bag|\bbag\b/);
    expect(focused.toLowerCase()).toMatch(/sparring|leather|50/);
  });

  it("rewriteSearchQuery focuses kit laundry-list asks on gloves", () => {
    const { query } = rewriteSearchQuery({ toolQuery: kit, lastUser: kit });
    expect(query.toLowerCase()).toMatch(/glove/);
    expect(query.toLowerCase()).not.toMatch(/head\s*guard/);
  });

  it("ranks sparring gloves above head guards for kit queries", () => {
    const focused = focusPrimaryProductQuery(kit);
    const products = [
      {
        title: "RDX Sparring Boxing Gloves",
        collections: ["Boxing Gloves", "Sparring Gloves"],
      },
      {
        title: "RDX T1 Head Guard",
        collections: ["Head Guards"],
      },
      {
        title: "RDX Gym Bag",
        collections: ["Bags"],
      },
    ];
    const ranked = rankProductsByRelevance(products, focused);
    expect(ranked[0]?.product.title).toMatch(/glove/i);
    const filtered = filterProductsByQueryRelevance(products, focused);
    expect(filtered.products.some((p) => /glove/i.test(p.title))).toBe(true);
    expect(
      filtered.products.every((p) => !/head\s*guard/i.test(p.title)),
    ).toBe(true);
  });

  it("does not alter a plain gloves query", () => {
    expect(focusPrimaryProductQuery("sparring gloves under £50")).toMatch(
      /sparring gloves under/i,
    );
  });
});
