import { describe, expect, it } from "vitest";
import { normalizeKeyword } from "@/lib/product-cache";

describe("normalizeKeyword", () => {
  it("strips stop words and sorts tokens", () => {
    expect(normalizeKeyword("What is the price of Wako Shin Guard")).toBe(
      "guard shin wako"
    );
  });

  it("collapses duplicates and case", () => {
    expect(normalizeKeyword("Boxing boxing GLOVES")).toBe("boxing gloves");
  });

  it("handles empty-ish input", () => {
    expect(normalizeKeyword("the a an")).toBe("");
  });
});
