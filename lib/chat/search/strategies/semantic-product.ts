/**
 * SemanticProductStrategy — MCP search_catalog for specific product asks.
 */

import { compactCatalogMcpText } from "@/lib/shopify/compact-catalog";
import { enrichSearchCatalogWithStorefront } from "@/lib/shopify/storefront-product-search";
import type {
  SearchStrategy,
  StrategyDeps,
  StrategyRequest,
  StrategyResult,
} from "@/lib/chat/search/strategies/types";
import { normalizeProductOrdering } from "@/lib/chat/search/ranking";
import { SEARCH_RESULT_LIMIT } from "@/lib/chat/agent/config";
import type { ShownProduct } from "@/lib/chat/context/product-memory";

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
  };
  try {
    parsed = JSON.parse(compactJson) as typeof parsed;
  } catch {
    return [];
  }

  const ranked = normalizeProductOrdering(
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
  );

  return ranked.map((p) => ({
    id: p.id!,
    title: p.title,
    price: p.price,
    wasPrice: p.wasPrice,
    url: p.url,
    inStock: p.inStock,
    onSale: p.onSale,
  }));
}

export const semanticProductStrategy: SearchStrategy = {
  name: "semantic_product",

  canHandle(request: StrategyRequest): boolean {
    return Boolean(request.canonicalSearch.trim());
  },

  async execute(
    request: StrategyRequest,
    deps: StrategyDeps,
  ): Promise<StrategyResult | null> {
    const page = await deps.catalogRepo.searchCatalog({
      query: request.canonicalSearch,
      availableOnly: request.availableOnly,
      limit: SEARCH_RESULT_LIMIT,
      signal: request.signal,
    });

    let raw = page.rawJson;
    try {
      raw = await enrichSearchCatalogWithStorefront(raw, request.canonicalSearch, {
        signal: request.signal,
      });
    } catch {
      // Enrichment is best-effort.
    }

    const compactJson = compactCatalogMcpText(raw, {
      query: request.canonicalSearch,
      rankByRelevance: true,
    });

    let productCount = 0;
    try {
      const parsed = JSON.parse(compactJson) as { productCount?: number };
      productCount =
        typeof parsed.productCount === "number"
          ? parsed.productCount
          : productsFromCompact(compactJson).length;
    } catch {
      productCount = 0;
    }

    const products = productsFromCompact(compactJson);

    return {
      strategy: "semantic_product",
      products,
      totalCount: productCount || products.length,
      canonicalSearch: request.canonicalSearch,
      reusedContext: false,
      compactJson,
    };
  },
};
