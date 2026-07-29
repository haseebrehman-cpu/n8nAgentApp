import { describe, expect, it } from "vitest";
import { classifySearchConfidence } from "@/lib/chat/search/confidence";

describe("classifySearchConfidence", () => {
  it("returns empty for zero products", () => {
    expect(classifySearchConfidence({ productCount: 0 })).toBe("empty");
  });

  it("returns high for a strong single match", () => {
    expect(
      classifySearchConfidence({ productCount: 1, topScores: [55] }),
    ).toBe("high");
  });

  it("returns low for weak few hits", () => {
    expect(
      classifySearchConfidence({ productCount: 2, topScores: [5, 3] }),
    ).toBe("low");
  });

  it("returns partial for moderate multi-hit sets", () => {
    expect(
      classifySearchConfidence({
        productCount: 5,
        topScores: [22, 18, 15],
      }),
    ).toBe("partial");
  });
});
