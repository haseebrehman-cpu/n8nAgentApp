/**
 * Intent barrel: the public surface for message classification. Grouped by
 * responsibility (order, discount, safety, shopping message) but exposed as a
 * single import site for the agent orchestrator and tests.
 */

export {
  ORDER_TRACKING_INTENT_RE,
  HARMFUL_QUERY_RE,
  QUERY_TYPO_MAP,
  BROAD_TOPIC_PHRASES,
  CATEGORY_BROWSE_PHRASES,
  PRODUCT_MODEL_CODE_RE,
  PRODUCT_NOUN_RE,
  PURCHASE_INTENT_RE,
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

export {
  isHarmfulQuery,
  isPromptInjectionAttempt,
} from "@/lib/chat/intent/safety";

export { isHumanEscalationRequest } from "@/lib/chat/intent/escalation";

export {
  normalizeSearchQuery,
  isCatalogCountQuery,
  extractModelCodeFromQuery,
  normalizeBrowseKey,
  isExplicitCatalogListQuery,
  isInventoryQuantityQuery,
  isCategoryBrowseQuery,
  resolveCatalogResponseMode,
  hasExplicitCatalogListOrCountIntent,
  needsProductClarification,
  isAmbiguousBrowseQuery,
  hasNamedProductModel,
  isPurchaseOrProductInterest,
  isProductFollowUpQuery,
  hasRecentProductContext,
  isOffTopicQuery,
  shouldForceProductSearch,
} from "@/lib/chat/intent/message";
export type { CatalogResponseMode } from "@/lib/chat/intent/message";

export {
  resolveCustomerJourney,
  journeyForcesCatalogSearch,
  extractBudgetMax,
  isGreeting,
  isThanks,
  isGoodbye,
  isOrderCancelRequest,
  isOrderModifyRequest,
  isAddressChangeRequest,
  isContactSupportRequest,
} from "@/lib/chat/intent/journeys";
export type { JourneyKind, JourneyMatch } from "@/lib/chat/intent/journeys";
