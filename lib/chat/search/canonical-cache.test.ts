import { describe, expect, it } from "vitest";
import { buildFilterKey, cacheKey } from "@/lib/chat/search/canonical-cache";

describe("canonical cache keys", () => {
  it("produces identical keys for identical filters", () => {
    const a = cacheKey("yoga strap", { budgetMax: 30, onSaleOnly: true });
    const b = cacheKey("yoga strap", { onSaleOnly: true, budgetMax: 30 });
    expect(a).toBe(b);
  });

  it("changes key when filters differ", () => {
    expect(buildFilterKey({ budgetMax: 20 })).not.toBe(
      buildFilterKey({ budgetMax: 40 }),
    );
  });
});
