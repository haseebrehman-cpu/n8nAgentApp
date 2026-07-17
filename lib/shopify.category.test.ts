import { describe, expect, it } from "vitest";

/**
 * Lightweight pure helpers mirrored from shopify category matching.
 * Keeps collection scoring behavior covered without hitting Shopify.
 */
function slugifyCategory(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function scoreCollectionMatch(
  category: string,
  title: string,
  handle: string
): number {
  const c = category.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  const h = handle.trim().toLowerCase();
  const slug = slugifyCategory(category);

  if (h === slug) return 100;
  if (t === c) return 95;
  if (h.includes(slug) && slug.length >= 4) return 80;
  if (t.includes(c) && c.length >= 4) return 75;
  if (slug && (h.startsWith(slug) || t.startsWith(c))) return 70;
  return 0;
}

function toProductTypeLabel(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

describe("category collection matching", () => {
  it("slugifies category names", () => {
    expect(slugifyCategory("Yoga")).toBe("yoga");
    expect(slugifyCategory("Boxing Gloves")).toBe("boxing-gloves");
  });

  it("scores exact yoga collection highest", () => {
    expect(scoreCollectionMatch("yoga", "Yoga", "yoga")).toBe(100);
    expect(scoreCollectionMatch("yoga", "Yoga Mats", "yoga-mats")).toBe(80);
    expect(scoreCollectionMatch("yoga", "Boxing", "boxing")).toBe(0);
  });

  it("prefers exact boxing-gloves handle over sale aliases", () => {
    expect(
      scoreCollectionMatch("boxing gloves", "Boxing Gloves", "boxing-gloves")
    ).toBe(100);
    expect(
      scoreCollectionMatch(
        "boxing gloves",
        "Boxing Gloves",
        "deals-women-boxing-gloves"
      )
    ).toBe(95);
  });

  it("normalizes category names to Shopify productType labels", () => {
    expect(toProductTypeLabel("boxing gloves")).toBe("Boxing Gloves");
    expect(toProductTypeLabel("BOXING GLOVES")).toBe("Boxing Gloves");
    expect(toProductTypeLabel("belt")).toBe("Belt");
    expect(toProductTypeLabel("belts")).toBe("Belts");
  });
});
