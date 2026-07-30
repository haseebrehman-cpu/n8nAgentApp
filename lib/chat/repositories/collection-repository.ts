/**
 * Collection repository adapter — Storefront directory + products.json
 * for stable category membership and counts that match the website.
 */

import { getStoreCollections } from "@/lib/shopify/collection-directory";
import { fetchStorefrontCollectionsMerged } from "@/lib/shopify/storefront-collection";
import { compactCatalogMcpText } from "@/lib/shopify/compact-catalog";
import type {
  CatalogProductRef,
  CollectionProductsResult,
  CollectionRef,
  ICollectionRepository,
} from "@/lib/chat/repositories/types";

function toProductRefs(compactJson: string): CatalogProductRef[] {
  let parsed: {
    products?: Array<{
      id?: string;
      title?: string;
      url?: string | null;
      price?: string | null;
      wasPrice?: string | null;
      inStock?: boolean | null;
      onSale?: boolean;
      summary?: string | null;
      collections?: string[];
      relevanceScore?: number;
    }>;
  };
  try {
    parsed = JSON.parse(compactJson) as typeof parsed;
  } catch {
    return [];
  }
  const out: CatalogProductRef[] = [];
  for (const p of parsed.products ?? []) {
    const id = String(p.id ?? "").trim();
    const title = String(p.title ?? "").trim();
    if (!id || !title) continue;
    out.push({
      id,
      title,
      url: p.url ?? null,
      price: p.price ?? null,
      wasPrice: p.wasPrice ?? null,
      inStock: typeof p.inStock === "boolean" ? p.inStock : null,
      onSale: p.onSale === true,
      summary: p.summary ?? null,
      collections: p.collections,
      relevanceScore: p.relevanceScore,
    });
  }
  return out;
}

export class StorefrontCollectionRepository implements ICollectionRepository {
  async listCollections(signal?: AbortSignal): Promise<CollectionRef[]> {
    const cols = await getStoreCollections({ signal });
    return cols.map((c) => ({
      handle: c.handle,
      title: c.title,
      productsCount: c.productsCount,
    }));
  }

  async fetchCollectionProducts(
    handles: string[],
    options: {
      availableOnly?: boolean;
      signal?: AbortSignal;
      query?: string;
    } = {},
  ): Promise<CollectionProductsResult | null> {
    if (handles.length === 0) return null;
    const compactOpts = {
      skipRelevanceFilter: true as const,
      rankByRelevance: false as const,
      query: options.query,
    };
    const all = await this.listCollections(options.signal);
    const byHandle = new Map(all.map((c) => [c.handle, c]));
    const selected = handles
      .map((h) => byHandle.get(h))
      .filter((c): c is CollectionRef => Boolean(c));
    if (selected.length === 0) {
      // Fall back to bare handles if directory miss (still valid on storefront).
      const bare = handles.map((h) => ({ handle: h, title: h, productsCount: 0 }));
      const raw = await fetchStorefrontCollectionsMerged(bare, {
        signal: options.signal,
        availableOnly: options.availableOnly,
      });
      const compact = compactCatalogMcpText(raw, compactOpts);
      const products = toProductRefs(compact);
      return {
        products,
        collection: bare[0]!,
        totalCount: products.length,
      };
    }

    const raw = await fetchStorefrontCollectionsMerged(selected, {
      signal: options.signal,
      availableOnly: options.availableOnly,
    });
    const compact = compactCatalogMcpText(raw, compactOpts);
    const products = toProductRefs(compact);
    return {
      products,
      collection: selected[0]!,
      totalCount: products.length,
    };
  }
}

export function createCollectionRepository(): ICollectionRepository {
  return new StorefrontCollectionRepository();
}
