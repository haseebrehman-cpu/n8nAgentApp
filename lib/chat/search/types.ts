/**
 * Domain types for the semantic product-search application layer.
 * Keep these free of infrastructure (MCP/HTTP) so scoring and confidence
 * stay pure and testable.
 */

import type { CatalogResponseMode } from "@/lib/chat/intent";
import type { ShownProduct } from "@/lib/chat/context/product-memory";

/** Confidence band used to drive fallbacks and model hints. */
export type SearchConfidence = "empty" | "low" | "partial" | "high";

export interface SemanticSearchRequest {
  /** Model- or server-authored catalog query (may be rewritten). */
  query: string;
  /** Raw customer message for this turn (mode / intent signals). */
  lastUser: string;
  /** Prior successful search query from session memory. */
  lastSearchQuery?: string | null;
  /** Products most recently shown — used for attribute follow-up reuse. */
  lastShownProducts?: ShownProduct[] | null;
  availableOnly?: boolean;
  forCount?: boolean;
  limit?: number;
  signal?: AbortSignal;
  /** When set, drop products priced above this major-unit amount. */
  budgetMax?: number;
  /** When true, keep only on-sale products (wasPrice / onSale). */
  onSaleOnly?: boolean;
}

export interface SemanticSearchResult {
  /** Wrapped or unwrapped compacted catalog JSON ready for the model. */
  compactJson: string;
  /** Query actually executed after rewrite / fallback. */
  effectiveQuery: string;
  /** Original (normalized) query before broadening fallbacks. */
  originalQuery: string;
  mode: CatalogResponseMode;
  confidence: SearchConfidence;
  productCount: number;
  fallbackApplied: boolean;
  /** True when results came from filtering lastShownProducts (no MCP). */
  reusedContext: boolean;
  /** Label for collection-backed results, if any. */
  collectionLabel?: string;
}

/** Minimal product shape used by pure scoring (compact or raw). */
export interface ScoreableProduct {
  id?: string;
  title: string;
  handle?: string;
  url?: string | null;
  collections?: string[];
  variants?: { title?: string; sku?: string }[];
  productOptions?: { name: string; values: string[] }[];
  price?: string | null;
}
