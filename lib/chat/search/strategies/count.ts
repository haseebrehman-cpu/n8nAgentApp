/**
 * CountStrategy — unique product counts for "how many …" questions.
 */

import { searchCatalogForCount } from "@/lib/chat/agent/catalog-count";
import { compactCatalogMcpText } from "@/lib/shopify/compact-catalog";
import type {
  SearchStrategy,
  StrategyDeps,
  StrategyRequest,
  StrategyResult,
} from "@/lib/chat/search/strategies/types";
import { normalizeProductOrdering, uniqueProductCount } from "@/lib/chat/search/ranking";
import type { ShownProduct } from "@/lib/chat/context/product-memory";
import { collectionBrowseStrategy } from "@/lib/chat/search/strategies/collection-browse";

function productsFromCompact(compactJson: string): ShownProduct[] {
  let parsed: {
    products?: Array<{
      id?: string;
      title?: string;
      price?: string | null;
      wasPrice?: string | null;
      url?: string | null;
      inStock?: boolean | null;
      onSale?: boolean;
      relevanceScore?: number;
      handle?: string;
    }>;
    productCount?: number;
  };
  try {
    parsed = JSON.parse(compactJson) as typeof parsed;
  } catch {
    return [];
  }
  return normalizeProductOrdering(
    (parsed.products ?? [])
      .filter((p) => p.id && p.title)
      .map((p) => ({
        id: String(p.id),
        title: String(p.title),
        handle: p.handle,
        url: p.url ?? null,
        relevanceScore: p.relevanceScore,
        price: p.price ?? null,
        wasPrice: p.wasPrice ?? null,
        inStock: typeof p.inStock === "boolean" ? p.inStock : null,
        onSale: p.onSale === true,
      })),
  ).map((p) => ({
    id: p.id!,
    title: p.title,
    price: p.price,
    wasPrice: p.wasPrice,
    url: p.url,
    inStock: p.inStock,
    onSale: p.onSale,
  }));
}

export const countStrategy: SearchStrategy = {
  name: "count",

  canHandle(request: StrategyRequest): boolean {
    return (
      request.forCount === true ||
      /\bhow\s+many\b/i.test(request.message)
    );
  },

  async execute(
    request: StrategyRequest,
    deps: StrategyDeps,
  ): Promise<StrategyResult | null> {
    // Prefer collection membership totals when we have a category match.
    if (request.categoryMatch?.primary) {
      const browse = await collectionBrowseStrategy.execute(request, deps);
      if (browse) {
        return {
          ...browse,
          strategy: "count",
          totalCount: uniqueProductCount(browse.products) || browse.totalCount,
        };
      }
    }

    const { raw, exhausted } = await searchCatalogForCount(
      request.canonicalSearch,
      request.availableOnly === true,
      { signal: request.signal },
    );

    const compactJson = compactCatalogMcpText(raw, {
      query: request.canonicalSearch,
      rankByRelevance: true,
      exhaustedSearch: exhausted,
    });

    let totalCount = 0;
    try {
      const parsed = JSON.parse(compactJson) as { productCount?: number };
      totalCount =
        typeof parsed.productCount === "number" ? parsed.productCount : 0;
    } catch {
      totalCount = 0;
    }

    const products = productsFromCompact(compactJson);
    if (!totalCount) totalCount = uniqueProductCount(products);

    return {
      strategy: "count",
      products,
      totalCount,
      canonicalSearch: request.canonicalSearch,
      reusedContext: false,
      compactJson,
    };
  },
};
