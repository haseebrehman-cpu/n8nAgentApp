/**
 * Re-exports pure ranking helpers from the catalog compaction module so the
 * search application layer has a stable import path (Clean Architecture
 * boundary) without duplicating scoring logic.
 */

export {
  dedupeProductsById,
  scoreProductRelevance,
  rankProductsByRelevance,
  extractProductTerms,
  matchTermsForQuery,
  type RankedProduct,
} from "@/lib/shopify/compact-catalog";
