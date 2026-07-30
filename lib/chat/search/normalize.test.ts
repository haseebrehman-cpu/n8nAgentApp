import { describe, expect, it } from "vitest";
import {
  extractExperienceSignal,
  normalizeCanonicalSearch,
} from "@/lib/chat/search/normalize";

describe("canonical search normalization", () => {
  it("collapses plain/simple/basic paraphrases", () => {
    const a = normalizeCanonicalSearch("plain yoga straps");
    const b = normalizeCanonicalSearch("simple yoga strap");
    const c = normalizeCanonicalSearch("basic cotton yoga straps");
    expect(a).toContain("yoga");
    expect(a).toContain("strap");
    expect(b).toContain("yoga");
    expect(c).toContain("basic");
    expect(normalizeCanonicalSearch("plain yoga straps")).toBe(a);
  });

  it("strips availability filler from canonical search", () => {
    expect(normalizeCanonicalSearch("how many plain yoga straps available")).toBe(
      normalizeCanonicalSearch("plain yoga straps"),
    );
    expect(normalizeCanonicalSearch("yoga straps in stock")).toBe("yoga strap");
  });

  it("reuses prior canonical for attribute-only follow-ups", () => {
    expect(normalizeCanonicalSearch("only blue", "boxing glove")).toBe(
      "boxing glove",
    );
  });

  it("extracts experience signals", () => {
    expect(extractExperienceSignal("I'm new to this")).toBe("beginner");
    expect(extractExperienceSignal("I compete")).toBe("professional");
    expect(extractExperienceSignal("I train daily")).toBe("intermediate");
  });
});
