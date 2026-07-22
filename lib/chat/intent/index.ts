/**
 * Intent barrel: the public surface for message classification. Grouped by
 * responsibility (order, discount, safety, shopping message) but exposed as a
 * single import site for the agent orchestrator and tests.
 */

export {
  ORDER_TRACKING_INTENT_RE,
  HARMFUL_QUERY_RE,
  QUERY_TYPO_MAP,
  CATEGORY_BROWSE_PHRASES,
} from "@/lib/chat/intent/patterns";

export {
  isOrderTrackingIntent,
  isBareOrderNumberToken,
  extractOrderNumberFromText,
  extractEmailFromText,
  stripOrderTrackingPhrases,
  extractOrderLookupToken,
} from "@/lib/chat/intent/order";

export { isDiscountCodeQuery, isDiscountQuery } from "@/lib/chat/intent/discount";

export { isHarmfulQuery } from "@/lib/chat/intent/safety";

export { isHumanEscalationRequest } from "@/lib/chat/intent/escalation";

export {
  normalizeSearchQuery,
  isCatalogCountQuery,
  normalizeBrowseKey,
  hasExplicitCatalogListOrCountIntent,
  needsProductClarification,
  isAmbiguousBrowseQuery,
  isProductFollowUpQuery,
  hasRecentProductContext,
  isOffTopicQuery,
  shouldForceProductSearch,
} from "@/lib/chat/intent/message";
