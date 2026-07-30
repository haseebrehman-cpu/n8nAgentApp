import { describe, expect, it } from "vitest";
import {
  dedupeByProductId,
  normalizeProductOrdering,
  stableProductSort,
  uniqueProductCount,
} from "@/lib/chat/search/ranking";

describe("product ranking / dedupe", () => {
  it("removes duplicate product ids keeping first occurrence", () => {
    const products = [
      { id: "1", title: "Alpha" },
      { id: "2", title: "Beta" },
      { id: "1", title: "Alpha Dup" },
      { id: "3", title: "Gamma" },
    ];
    expect(dedupeByProductId(products).map((p) => p.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(uniqueProductCount(products)).toBe(3);
  });

  it("sorts by relevance, then title, handle, id", () => {
    const products = [
      { id: "b", title: "Zebra", handle: "z", relevanceScore: 10 },
      { id: "a", title: "Alpha", handle: "a", relevanceScore: 10 },
      { id: "c", title: "Alpha", handle: "b", relevanceScore: 10 },
      { id: "d", title: "Mid", handle: "m", relevanceScore: 50 },
    ];
    const ordered = stableProductSort(products);
    expect(ordered.map((p) => p.id)).toEqual(["d", "a", "c", "b"]);
  });

  it("identical inputs always produce identical ordering", () => {
    const products = [
      { id: "2", title: "B", handle: "b", relevanceScore: 5 },
      { id: "1", title: "A", handle: "a", relevanceScore: 5 },
      { id: "2", title: "B dup", handle: "b", relevanceScore: 5 },
    ];
    const a = normalizeProductOrdering(products);
    const b = normalizeProductOrdering(products);
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    expect(a.map((p) => p.id)).toEqual(["1", "2"]);
  });
});
