/**
 * Classify search result confidence from hit counts and relevance scores.
 * Pure functions — no I/O.
 */

import type { SearchConfidence } from "@/lib/chat/search/types";

export interface ConfidenceInput {
  productCount: number;
  /** Top relevance scores after ranking (highest first). */
  topScores?: number[];
  /** True when a hard relevance filter removed every hit. */
  relevanceEmptied?: boolean;
}

/** Minimum top score to treat a single-hit result as high confidence. */
const HIGH_SINGLE_SCORE = 40;
/** Minimum average of top-3 scores for "high" when multiple hits. */
const HIGH_AVG_SCORE = 28;
/** Below this top score with few hits → low confidence. */
const LOW_TOP_SCORE = 12;

/**
 * Map retrieval quality to a confidence band used for fallbacks and hints.
 *
 * - empty: no products
 * - low: few weak matches — broaden or clarify
 * - partial: some matches but ranking is soft / thin
 * - high: strong title/model/collection alignment
 */
export function classifySearchConfidence(
  input: ConfidenceInput,
): SearchConfidence {
  const count = input.productCount;
  if (count <= 0 || input.relevanceEmptied) return "empty";

  const scores = input.topScores ?? [];
  const top = scores[0] ?? 0;
  const avgTop =
    scores.length > 0
      ? scores.slice(0, 3).reduce((a, b) => a + b, 0) /
        Math.min(3, scores.length)
      : 0;

  if (count === 1) {
    return top >= HIGH_SINGLE_SCORE ? "high" : top >= LOW_TOP_SCORE ? "partial" : "low";
  }

  if (top < LOW_TOP_SCORE && count <= 3) return "low";
  if (avgTop >= HIGH_AVG_SCORE || top >= HIGH_SINGLE_SCORE) return "high";
  if (count >= 4 || top >= LOW_TOP_SCORE) return "partial";
  return "low";
}
