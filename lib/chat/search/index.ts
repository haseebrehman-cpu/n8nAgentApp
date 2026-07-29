/**
 * Public barrel for the semantic product-search application layer.
 */

export type {
  SearchConfidence,
  SemanticSearchRequest,
  SemanticSearchResult,
  ScoreableProduct,
} from "@/lib/chat/search/types";

export {
  isEmptyCatalogResult,
  isCatalogInfraFailure,
} from "@/lib/chat/search/catalog-empty";
export { classifySearchConfidence } from "@/lib/chat/search/confidence";
export {
  normalizeSemanticQuery,
  rewriteSearchQuery,
  mergeRefinementIntoQuery,
  isSearchRefinement,
  buildFallbackQueries,
} from "@/lib/chat/search/query-rewrite";
export {
  tryFilterLastShownProducts,
  shownProductsToCatalogJson,
} from "@/lib/chat/search/context-filter";
export {
  dedupeProductsById,
  scoreProductRelevance,
  rankProductsByRelevance,
} from "@/lib/chat/search/score";
export { executeSemanticSearch } from "@/lib/chat/search/orchestrator";
export {
  applyCatalogPostFilters,
  filterProductsByBudget,
  filterProductsOnSale,
} from "@/lib/chat/search/post-filter";
