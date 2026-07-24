/**
 * Recover products that Shopify MCP `search_catalog` fails to index.
 *
 * Public storefront `/search/suggest.json` often finds exact titles that MCP
 * search omits (e.g. "RDX T15 Noir MMA Sparring Gloves 7oz"). When a query is
 * product-specific and MCP has no strong title match, we merge those suggest
 * hits via `lookup_catalog` (by id) before compaction.
 */

import { logger } from "@/lib/logger";
import {
  matchTermsForQuery,
  titleHasTermForMatch,
} from "@/lib/shopify/compact-catalog";
import { storefrontCatalogOrigin } from "@/lib/shopify/storefront-collection";
import { lookupCatalog } from "@/lib/shopify/storefront-mcp";

const MAX_ENRICH_IDS = 3;
const DEFAULT_SUGGEST_LIMIT = 10;

/** Model-like tokens: T15, F6, T6, AS2, IMMAF-1 style fragments. */
const MODEL_TOKEN_RE = /\b[a-z]{0,3}\d{1,4}[a-z]{0,3}\b/i;

export interface StorefrontProductSuggestion {
  id: string;
  title: string;
  handle: string;
  url: string | null;
}

interface SuggestProductRaw {
  id?: number | string;
  title?: string;
  handle?: string;
  url?: string;
}

interface McpProductRef {
  id?: string;
  title?: string;
}

function normalizeTitle(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when the query is specific enough to warrant exact-title recovery. */
export function isProductSpecificQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (MODEL_TOKEN_RE.test(trimmed)) return true;
  return matchTermsForQuery(trimmed).length >= 5;
}

/**
 * Exact title match (case/whitespace insensitive), or every relevance term
 * appears in the product title.
 */
export function hasStrongTitleMatch(productTitle: string, query: string): boolean {
  const title = String(productTitle ?? "").trim();
  const q = query.trim();
  if (!title || !q) return false;

  if (normalizeTitle(title) === normalizeTitle(q)) return true;

  const terms = matchTermsForQuery(q);
  if (terms.length === 0) return false;
  return terms.every((t) => titleHasTermForMatch(title, t));
}

function toProductGid(id: number | string): string | null {
  if (typeof id === "number" && Number.isFinite(id) && id > 0) {
    return `gid://shopify/Product/${Math.trunc(id)}`;
  }
  const raw = String(id ?? "").trim();
  if (!raw) return null;
  if (/^gid:\/\/shopify\/Product\/\d+$/i.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Product/${raw}`;
  return null;
}

/**
 * Public storefront product suggestions for a free-text query.
 */
export async function fetchStorefrontProductSuggestions(
  query: string,
  options: { signal?: AbortSignal; limit?: number } = {},
): Promise<StorefrontProductSuggestion[]> {
  const q = query.trim();
  if (!q) return [];

  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_SUGGEST_LIMIT, 1),
    20,
  );
  const origin = storefrontCatalogOrigin();
  const url =
    `${origin}/search/suggest.json?q=${encodeURIComponent(q)}` +
    `&resources[type]=product&resources[limit]=${limit}`;

  const res = await fetch(url, {
    signal: options.signal,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Storefront suggest failed (${res.status})`);
  }

  const data = (await res.json()) as {
    resources?: { results?: { products?: SuggestProductRaw[] } };
  };
  const raw = data.resources?.results?.products ?? [];
  const out: StorefrontProductSuggestion[] = [];

  for (const p of raw) {
    const gid = toProductGid(p.id ?? "");
    const title = String(p.title ?? "").trim();
    if (!gid || !title) continue;
    const handle = String(p.handle ?? "").trim();
    let productUrl: string | null = null;
    if (typeof p.url === "string" && p.url.trim()) {
      productUrl = p.url.startsWith("http")
        ? p.url.trim()
        : `${origin}${p.url.trim()}`;
    } else if (handle) {
      productUrl = `${origin}/products/${handle}`;
    }
    out.push({ id: gid, title, handle, url: productUrl });
  }

  return out;
}

function parseMcpProducts(mcpRawJson: string): {
  obj: Record<string, unknown>;
  products: McpProductRef[];
} | null {
  const trimmed = mcpRawJson?.trim() ?? "";
  if (!trimmed) return null;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.products)) return null;
  return { obj, products: obj.products as McpProductRef[] };
}

/**
 * If MCP search missed a strong storefront title match for a product-specific
 * query, lookup those products by id and prepend them to the MCP payload.
 */
export async function enrichSearchCatalogWithStorefront(
  mcpRawJson: string,
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const parsed = parseMcpProducts(mcpRawJson);
  if (!parsed) return mcpRawJson;

  const q = query.trim();
  if (!q || !isProductSpecificQuery(q)) return mcpRawJson;

  const { obj, products } = parsed;
  if (products.some((p) => hasStrongTitleMatch(String(p.title ?? ""), q))) {
    return mcpRawJson;
  }

  let suggestions: StorefrontProductSuggestion[];
  try {
    suggestions = await fetchStorefrontProductSuggestions(q, {
      signal: options.signal,
      limit: DEFAULT_SUGGEST_LIMIT,
    });
  } catch (err) {
    logger.warn("storefront-product-search", "suggest fetch failed; keeping MCP", {
      query: q,
      error: err instanceof Error ? err.message : String(err),
    });
    return mcpRawJson;
  }

  const mcpIds = new Set(
    products
      .map((p) => String(p.id ?? "").trim())
      .filter(Boolean),
  );

  const strong = suggestions.filter(
    (s) => hasStrongTitleMatch(s.title, q) && !mcpIds.has(s.id),
  );
  if (strong.length === 0) return mcpRawJson;

  // Prefer exact title matches, then keep suggest order for the rest.
  const exactNorm = normalizeTitle(q);
  strong.sort((a, b) => {
    const aExact = normalizeTitle(a.title) === exactNorm ? 0 : 1;
    const bExact = normalizeTitle(b.title) === exactNorm ? 0 : 1;
    return aExact - bExact;
  });

  const ids = strong.slice(0, MAX_ENRICH_IDS).map((s) => s.id);

  let lookupRaw: string;
  try {
    lookupRaw = await lookupCatalog({ ids }, { signal: options.signal });
  } catch (err) {
    logger.warn("storefront-product-search", "lookup_catalog failed; keeping MCP", {
      query: q,
      ids,
      error: err instanceof Error ? err.message : String(err),
    });
    return mcpRawJson;
  }

  let lookedUp: unknown;
  try {
    lookedUp = JSON.parse(lookupRaw);
  } catch {
    return mcpRawJson;
  }
  if (!lookedUp || typeof lookedUp !== "object") return mcpRawJson;

  const lookedObj = lookedUp as Record<string, unknown>;
  const lookedProducts = Array.isArray(lookedObj.products)
    ? (lookedObj.products as McpProductRef[])
    : lookedObj.product && typeof lookedObj.product === "object"
      ? [lookedObj.product as McpProductRef]
      : [];

  // Keep lookup order aligned with our preferred ids.
  const byId = new Map(
    lookedProducts
      .map((p) => [String(p.id ?? "").trim(), p] as const)
      .filter(([id]) => Boolean(id)),
  );
  const prepend: McpProductRef[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p) prepend.push(p);
  }

  if (prepend.length === 0) return mcpRawJson;

  logger.info("storefront-product-search", "merged storefront exact matches into MCP", {
    query: q,
    added: prepend.map((p) => ({ id: p.id, title: p.title })),
  });

  return JSON.stringify({
    ...obj,
    products: [...prepend, ...products],
  });
}
