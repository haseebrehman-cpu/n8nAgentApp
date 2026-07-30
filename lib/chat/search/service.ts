/**
 * Search Service — selects a strategy, normalizes the query, ranks/dedupes,
 * and returns a deterministic StrategyResult.
 */

import {
  discoverCategories,
  type CategoryMatchResult,
} from "@/lib/chat/catalog/category-discovery";
import type { ConversationCatalogContext } from "@/lib/chat/context/conversation-context";
import type { SearchFilters } from "@/lib/chat/context/conversation-context";
import {
  createCatalogRepository,
  createCollectionRepository,
  type ICatalogRepository,
  type ICollectionRepository,
} from "@/lib/chat/repositories";
import {
  extractExperienceSignal,
  normalizeCanonicalSearch,
} from "@/lib/chat/search/normalize";
import {
  collectionBrowseStrategy,
  contextReuseStrategy,
  countStrategy,
  semanticProductStrategy,
  type SearchStrategy,
  type StrategyDeps,
  type StrategyResult,
} from "@/lib/chat/search/strategies";
import { normalizeProductOrdering } from "@/lib/chat/search/ranking";
import {
  filterProductsByBudget,
  filterProductsOnSale,
} from "@/lib/chat/search/post-filter";
import { excludeIconicProductsUnlessRequested } from "@/lib/chat/search/iconic-filter";

export interface SearchServiceOptions {
  catalogRepo?: ICatalogRepository;
  collectionRepo?: ICollectionRepository;
  strategies?: SearchStrategy[];
}

export interface ExecuteSearchInput {
  message: string;
  catalogContext?: ConversationCatalogContext | null;
  filters?: SearchFilters;
  availableOnly?: boolean;
  forCount?: boolean;
  signal?: AbortSignal;
  /** Skip clarification — force search even if category is broad. */
  forceSearch?: boolean;
}

export interface ExecuteSearchOutput extends StrategyResult {
  categoryMatch: CategoryMatchResult;
  experience?: "beginner" | "intermediate" | "professional";
  needsClarification: boolean;
}

const DEFAULT_STRATEGIES: SearchStrategy[] = [
  countStrategy,
  contextReuseStrategy,
  collectionBrowseStrategy,
  semanticProductStrategy,
];

export class SearchService {
  private readonly deps: StrategyDeps;
  private readonly strategies: SearchStrategy[];

  constructor(options: SearchServiceOptions = {}) {
    this.deps = {
      catalogRepo: options.catalogRepo ?? createCatalogRepository(),
      collectionRepo: options.collectionRepo ?? createCollectionRepository(),
    };
    this.strategies = options.strategies ?? DEFAULT_STRATEGIES;
  }

  async execute(input: ExecuteSearchInput): Promise<ExecuteSearchOutput> {
    const prior = input.catalogContext?.canonicalSearch ?? null;
    const canonicalSearch = normalizeCanonicalSearch(input.message, prior);
    const experience = extractExperienceSignal(input.message);
    const filters: SearchFilters = {
      ...input.catalogContext?.filters,
      ...input.filters,
      ...(experience ? {} : {}),
    };

    const categoryMatch = await discoverCategories(
      canonicalSearch || input.message,
      this.deps.collectionRepo,
      input.signal,
    );

    const needsClarification =
      !input.forceSearch &&
      categoryMatch.needsClarification &&
      !input.forCount &&
      !/\bhow\s+many\b/i.test(input.message);

    if (needsClarification) {
      return {
        strategy: "collection_browse",
        products: [],
        totalCount: 0,
        canonicalSearch,
        reusedContext: false,
        categoryMatch,
        experience,
        needsClarification: true,
        followUpOptions: categoryMatch.children.map((c) => c.title).slice(0, 6),
        department: categoryMatch.primary?.department,
        category: categoryMatch.primary?.title,
      };
    }

    const request = {
      message: input.message,
      canonicalSearch,
      filters,
      catalogContext: input.catalogContext,
      availableOnly: input.availableOnly,
      forCount: input.forCount || /\bhow\s+many\b/i.test(input.message),
      signal: input.signal,
      categoryMatch: {
        primary: categoryMatch.primary,
        children: categoryMatch.children,
        needsClarification: categoryMatch.needsClarification,
      },
    };

    let result: StrategyResult | null = null;
    for (const strategy of this.strategies) {
      if (!strategy.canHandle(request)) continue;
      result = await strategy.execute(request, this.deps);
      if (result && (result.products.length > 0 || result.totalCount > 0 || strategy.name === "count")) {
        break;
      }
      // Try next strategy if this one returned empty.
      if (result && result.products.length === 0 && strategy.name !== "semantic_product") {
        result = null;
        continue;
      }
      if (result) break;
    }

    if (!result) {
      result = (await semanticProductStrategy.execute(request, this.deps)) ?? {
        strategy: "semantic_product",
        products: [],
        totalCount: 0,
        canonicalSearch,
        reusedContext: false,
      };
    }

    // Apply budget / sale / iconic filters deterministically.
    const beforeIconic = result.products.length;
    let products = excludeIconicProductsUnlessRequested(
      result.products,
      `${canonicalSearch} ${input.message}`,
    );
    const iconicRemoved = beforeIconic - products.length;
    if (filters.onSaleOnly) {
      products = filterProductsOnSale(products);
    }
    if (filters.budgetMax != null) {
      products = filterProductsByBudget(products, filters.budgetMax);
    }

    products = normalizeProductOrdering(
      products.map((p, i) => ({
        ...p,
        relevanceScore: products.length - i,
      })),
    ).map((p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      wasPrice: p.wasPrice,
      url: p.url,
      inStock: p.inStock,
      onSale: p.onSale,
    }));

    // Collection browse loads the full membership — total is the filtered length.
    // Semantic/count payloads may be capped; subtract Iconic removals from the
    // reported total when we know how many were dropped from the sample.
    let totalCount = result.totalCount;
    if (
      result.strategy === "collection_browse" ||
      beforeIconic >= result.totalCount
    ) {
      totalCount = products.length;
    } else if (iconicRemoved > 0) {
      totalCount = Math.max(products.length, result.totalCount - iconicRemoved);
    }

    return {
      ...result,
      products,
      totalCount,
      canonicalSearch,
      categoryMatch,
      experience,
      needsClarification: false,
    };
  }
}

export function createSearchService(
  options?: SearchServiceOptions,
): SearchService {
  return new SearchService(options);
}
