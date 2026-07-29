import { describe, expect, it } from "vitest";
import { isEmptyCatalogResult } from "@/lib/chat/search/catalog-empty";

function wrap(json: string): string {
  return `<CATALOG_DATA>\n${json}\n</CATALOG_DATA>\n\nhint`;
}

describe("isEmptyCatalogResult", () => {
  it("treats productCount 0 as empty", () => {
    expect(
      isEmptyCatalogResult(
        wrap(JSON.stringify({ productCount: 0, products: [] })),
      ),
    ).toBe(true);
  });

  it("treats empty products array as empty", () => {
    expect(
      isEmptyCatalogResult(wrap(JSON.stringify({ products: [] }))),
    ).toBe(true);
  });

  it("treats {} as empty", () => {
    expect(isEmptyCatalogResult(wrap("{}"))).toBe(true);
  });

  it("does not treat non-empty products as empty", () => {
    expect(
      isEmptyCatalogResult(
        wrap(
          JSON.stringify({
            productCount: 1,
            products: [{ id: "1", title: "Glove" }],
          }),
        ),
      ),
    ).toBe(false);
  });

  it("does not treat tool errors as empty catalog", () => {
    expect(
      isEmptyCatalogResult(JSON.stringify({ error: "lookup failed" })),
    ).toBe(false);
  });

  it("treats null product as empty", () => {
    expect(
      isEmptyCatalogResult(wrap(JSON.stringify({ product: null }))),
    ).toBe(true);
  });
});
