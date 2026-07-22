/**
 * Paginated catalog counting for "how many" questions. Fetches search pages
 * until the results are exhausted (or a safety cap is hit) and merges unique
 * products so the model isn't limited to a single page size when reporting
 * totals. Single responsibility: producing a full-count search payload.
 */

import { searchCatalog } from "@/lib/shopify/storefront-mcp";
import { COUNT_SEARCH_LIMIT, MAX_COUNT_PAGES } from "@/lib/chat/agent/config";

function paginationCursor(
  pag: Record<string, unknown> | undefined,
): string | null {
  if (!pag) return null;
  for (const key of [
    "next_cursor",
    "cursor",
    "end_cursor",
    "nextCursor",
    "endCursor",
  ]) {
    const value = pag[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Fetch search pages until exhausted (or safety cap). Used for "how many"
 * answers so productCount is not stuck at the default page size — any category.
 */
export async function searchCatalogForCount(
  query: string,
  availableOnly: boolean,
  options: { signal?: AbortSignal },
): Promise<{ raw: string; exhausted: boolean }> {
  const merged: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let exhausted = true;
  let lastMessages: unknown[] | undefined;
  let lastNotFound: unknown[] | undefined;

  for (let page = 0; page < MAX_COUNT_PAGES; page++) {
    const data = await searchCatalog(
      {
        query,
        pagination: cursor
          ? { limit: COUNT_SEARCH_LIMIT, cursor }
          : { limit: COUNT_SEARCH_LIMIT },
        filters: { available: availableOnly },
      },
      { signal: options.signal },
    );

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return { raw: data, exhausted: false };
    }

    const products = Array.isArray(parsed.products) ? parsed.products : [];
    for (const product of products) {
      if (!product || typeof product !== "object") continue;
      const id = String((product as { id?: unknown }).id ?? "").trim();
      const key = id || JSON.stringify(product);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(product);
    }

    if (Array.isArray(parsed.messages)) lastMessages = parsed.messages;
    if (Array.isArray(parsed.not_found)) lastNotFound = parsed.not_found;

    const pag =
      parsed.pagination && typeof parsed.pagination === "object"
        ? (parsed.pagination as Record<string, unknown>)
        : undefined;
    const hasMore = Boolean(pag?.has_next_page);
    const next = paginationCursor(pag);
    if (!hasMore || !next) {
      exhausted = true;
      break;
    }
    if (page === MAX_COUNT_PAGES - 1) {
      exhausted = false;
      break;
    }
    cursor = next;
  }

  const payload: Record<string, unknown> = {
    products: merged,
    pagination: { has_next_page: !exhausted },
  };
  if (lastMessages?.length) payload.messages = lastMessages;
  if (lastNotFound?.length) payload.not_found = lastNotFound;
  return { raw: JSON.stringify(payload), exhausted };
}
