/**
 * Catalog repository adapter — Shopify Storefront MCP as the product source.
 */

import {
  getProduct,
  lookupCatalog,
  searchCatalog,
  searchShopPoliciesAndFaqs,
} from "@/lib/shopify/storefront-mcp";
import type {
  CatalogProductRef,
  CatalogSearchOptions,
  CatalogSearchPage,
  ICatalogRepository,
} from "@/lib/chat/repositories/types";

function parseProducts(rawJson: string): CatalogProductRef[] {
  let parsed: { products?: unknown[] };
  try {
    parsed = JSON.parse(rawJson) as { products?: unknown[] };
  } catch {
    return [];
  }
  const out: CatalogProductRef[] = [];
  for (const raw of parsed.products ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const id = String(p.id ?? "").trim();
    const title = String(p.title ?? "").trim();
    if (!id || !title) continue;
    const collections = Array.isArray(p.collections)
      ? (p.collections as { title?: string }[])
          .map((c) => String(c.title ?? "").trim())
          .filter(Boolean)
      : undefined;
    out.push({
      id,
      title,
      handle: typeof p.handle === "string" ? p.handle : undefined,
      url: typeof p.url === "string" ? p.url : null,
      collections,
    });
  }
  return out;
}

function nextCursorFrom(rawJson: string): string | null {
  try {
    const parsed = JSON.parse(rawJson) as {
      pagination?: Record<string, unknown>;
    };
    const pag = parsed.pagination;
    if (!pag) return null;
    for (const key of [
      "next_cursor",
      "cursor",
      "end_cursor",
      "nextCursor",
      "endCursor",
    ]) {
      const v = pag[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export class McpCatalogRepository implements ICatalogRepository {
  async searchCatalog(options: CatalogSearchOptions): Promise<CatalogSearchPage> {
    const rawJson = await searchCatalog(
      {
        query: options.query,
        pagination: options.cursor
          ? { limit: options.limit ?? 10, cursor: options.cursor }
          : { limit: options.limit ?? 10 },
        filters:
          options.availableOnly === undefined
            ? undefined
            : { available: options.availableOnly },
      },
      { signal: options.signal },
    );
    return {
      rawJson,
      products: parseProducts(rawJson),
      nextCursor: nextCursorFrom(rawJson),
    };
  }

  async lookupByIds(ids: string[], signal?: AbortSignal): Promise<string> {
    return lookupCatalog({ ids }, { signal });
  }

  async getProduct(id: string, signal?: AbortSignal): Promise<string> {
    return getProduct({ id }, { signal });
  }

  async searchPolicies(query: string, signal?: AbortSignal): Promise<string> {
    return searchShopPoliciesAndFaqs({ query }, { signal });
  }
}

export function createCatalogRepository(): ICatalogRepository {
  return new McpCatalogRepository();
}
