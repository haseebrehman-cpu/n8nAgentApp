/**
 * Product Ranking Layer — deterministic dedupe and stable sort.
 * Identical result sets always produce identical ordering.
 */

export interface RankableProduct {
  id?: string;
  title: string;
  handle?: string;
  url?: string | null;
  relevanceScore?: number;
}

function handleFromProduct(p: RankableProduct): string {
  if (p.handle?.trim()) return p.handle.trim().toLowerCase();
  const url = typeof p.url === "string" ? p.url : "";
  const m = url.match(/\/products\/([^/?#]+)/i);
  return m?.[1]?.toLowerCase() ?? "";
}

/** Unique products by id — first occurrence wins (stable). */
export function dedupeByProductId<T extends { id?: string }>(products: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of products) {
    const id = String(p.id ?? "").trim();
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(p);
  }
  return out;
}

/**
 * Sort by relevance (desc), then title, handle, id — locale-independent ASCII
 * compare for cross-runtime stability.
 */
export function stableProductSort<T extends RankableProduct>(products: T[]): T[] {
  return [...products].sort((a, b) => {
    const scoreA = typeof a.relevanceScore === "number" ? a.relevanceScore : 0;
    const scoreB = typeof b.relevanceScore === "number" ? b.relevanceScore : 0;
    if (scoreB !== scoreA) return scoreB - scoreA;

    const titleCmp = a.title.localeCompare(b.title, "en", {
      sensitivity: "base",
    });
    if (titleCmp !== 0) return titleCmp;

    const handleCmp = handleFromProduct(a).localeCompare(
      handleFromProduct(b),
      "en",
      { sensitivity: "base" },
    );
    if (handleCmp !== 0) return handleCmp;

    return String(a.id ?? "").localeCompare(String(b.id ?? ""), "en");
  });
}

/** Dedupe then apply stable sort. */
export function normalizeProductOrdering<T extends RankableProduct>(
  products: T[],
): T[] {
  return stableProductSort(dedupeByProductId(products));
}

/** Unique product count after id dedupe. */
export function uniqueProductCount<T extends { id?: string }>(
  products: T[],
): number {
  return dedupeByProductId(products).filter((p) => String(p.id ?? "").trim())
    .length;
}
