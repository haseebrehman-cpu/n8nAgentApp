/**
 * CollectionBrowseStrategy — load products from matched storefront collections.
 */

import {
  followUpOptionsFromChildren,
} from "@/lib/chat/catalog/category-discovery";
import type {
  SearchStrategy,
  StrategyDeps,
  StrategyRequest,
  StrategyResult,
} from "@/lib/chat/search/strategies/types";
import { normalizeProductOrdering } from "@/lib/chat/search/ranking";
import {
  scoreProductRelevance,
} from "@/lib/chat/search/score";
import { excludeIconicProductsUnlessRequested } from "@/lib/chat/search/iconic-filter";
import type { ShownProduct } from "@/lib/chat/context/product-memory";
import type { CatalogProductRef } from "@/lib/chat/repositories/types";

function toShown(p: CatalogProductRef): ShownProduct {
  return {
    id: p.id,
    title: p.title,
    price: p.price ?? null,
    wasPrice: p.wasPrice ?? null,
    url: p.url ?? null,
    inStock: typeof p.inStock === "boolean" ? p.inStock : null,
    onSale: p.onSale === true,
  };
}

export const collectionBrowseStrategy: SearchStrategy = {
  name: "collection_browse",

  canHandle(request: StrategyRequest): boolean {
    return Boolean(request.categoryMatch?.primary);
  },

  async execute(
    request: StrategyRequest,
    deps: StrategyDeps,
  ): Promise<StrategyResult | null> {
    const primary = request.categoryMatch?.primary;
    if (!primary) return null;

    // Primary + nested child handles only (e.g. yoga-strap → yoga-strap-plain).
    // Never union same-department siblings/parents — that pulled the whole Yoga
    // catalog (141) into "plain yoga straps" and leaked Iconic Gear products
    // that only carry the fetched collection tag from products.json.
    const handles = [primary.handle];
    const children = request.categoryMatch?.children ?? [];
    for (const child of children) {
      if (child.handle.startsWith(`${primary.handle}-`)) {
        handles.push(child.handle);
      }
      if (handles.length >= 6) break;
    }

    const uniqueHandles = [...new Set(handles)];
    const result = await deps.collectionRepo.fetchCollectionProducts(
      uniqueHandles,
      {
        availableOnly: request.availableOnly,
        signal: request.signal,
        query: `${request.canonicalSearch} ${request.message}`,
      },
    );
    if (!result) return null;

    const scored = result.products.map((p) => ({
      ...p,
      relevanceScore: scoreProductRelevance(
        {
          id: p.id,
          title: p.title,
          url: p.url,
          collections: p.collections,
        },
        request.canonicalSearch,
      ),
    }));

    const ordered = normalizeProductOrdering(scored);
    const withoutIconic = excludeIconicProductsUnlessRequested(
      ordered,
      `${request.canonicalSearch} ${request.message}`,
    );
    const products = withoutIconic.map(toShown);

    return {
      strategy: "collection_browse",
      products,
      // Count unique non-Iconic products — never inflate totals with Iconic Gear.
      totalCount: withoutIconic.length,
      canonicalSearch: request.canonicalSearch,
      collectionHandle: result.collection.handle,
      collectionTitle: result.collection.title,
      department: primary.department,
      category: primary.title,
      reusedContext: false,
      followUpOptions: followUpOptionsFromChildren(children),
    };
  },
};
