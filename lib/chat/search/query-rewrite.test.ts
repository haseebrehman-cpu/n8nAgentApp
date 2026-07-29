import { describe, expect, it } from "vitest";
import {
  buildFallbackQueries,
  isSearchRefinement,
  mergeRefinementIntoQuery,
  normalizeSemanticQuery,
  rewriteSearchQuery,
} from "@/lib/chat/search/query-rewrite";

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
