/**
 * Chat Agent Orchestrator — deterministic routing for care, clarification,
 * and catalog shortlists before (or instead of) the open tool loop.
 */

import {
  applyPreferenceSignals,
  freezeSearchIntoContext,
  type ConversationCatalogContext,
} from "@/lib/chat/context/conversation-context";
import type { ShownProduct } from "@/lib/chat/context/product-memory";
import { createCatalogRepository } from "@/lib/chat/repositories";
import {
  recommendProducts,
  recommendationBenefits,
} from "@/lib/chat/recommend/engine";
import { buildClarificationReply } from "@/lib/chat/conversation/flow";
import {
  renderProductShortlist,
  shortlistWrapInstruction,
  SHORTLIST_DISPLAY_LIMIT,
} from "@/lib/chat/response/shortlist";
import { createSearchService } from "@/lib/chat/search/service";
import {
  buildCareFallbackReply,
  isCareQuestion,
  runCareSupport,
} from "@/lib/chat/support/care";
import { tryResolveRdxUrlTurn } from "@/lib/chat/url";
import type { JourneyMatch } from "@/lib/chat/intent/journeys";
import {
  isCatalogCountQuery,
  isExplicitCatalogListQuery,
  isProductFollowUpQuery,
  shouldForceProductSearch,
} from "@/lib/chat/intent/message";

export type OrchestratorDecision =
  | {
      kind: "final_reply";
      reply: string;
      intent: string;
      catalogContext?: ConversationCatalogContext | null;
      shownProducts?: ShownProduct[] | null;
      searchQuery?: string | null;
      pendingCategory?: string | null;
    }
  | {
      kind: "llm_wrap";
      /** System blocks to inject (shortlist / care guidance). */
      systemBlocks: string[];
      intent: string;
      catalogContext?: ConversationCatalogContext | null;
      shownProducts?: ShownProduct[] | null;
      searchQuery?: string | null;
      pendingCategory?: string | null;
      /** When true, skip forcing search_catalog — shortlist already built. */
      skipCatalogSearch: boolean;
      /** Optional pre-rendered reply if LLM unavailable. */
      fallbackReply?: string;
    }
  | {
      kind: "continue";
      intent?: string;
    };

export interface OrchestratorInput {
  lastUser: string;
  catalogContext?: ConversationCatalogContext | null;
  lastShownProducts?: ShownProduct[] | null;
  journey?: JourneyMatch | null;
  signal?: AbortSignal;
}

/**
 * Handle care, clarification, and deterministic catalog shortlists.
 * Returns `continue` when the open tool loop should run as usual.
 */
export async function resolveDeterministicTurn(
  input: OrchestratorInput,
): Promise<OrchestratorDecision> {
  const { lastUser, journey, signal } = input;

  // --- RDX storefront URL deep-links (never a free-text product search) ---
  const urlDecision = await tryResolveRdxUrlTurn({
    message: lastUser,
    signal,
  });
  if (urlDecision) {
    if (urlDecision.kind === "final_reply") {
      return {
        kind: "final_reply",
        reply: urlDecision.reply,
        intent: urlDecision.intent,
        shownProducts: urlDecision.shownProducts,
      };
    }
    return {
      kind: "llm_wrap",
      systemBlocks: urlDecision.systemBlocks,
      intent: urlDecision.intent,
      shownProducts: urlDecision.shownProducts,
      searchQuery: urlDecision.searchQuery,
      skipCatalogSearch: true,
      fallbackReply: urlDecision.fallbackReply,
      catalogContext: input.catalogContext,
    };
  }

  // --- Care / support (never a product search) ---
  if (isCareQuestion(lastUser)) {
    const care = await runCareSupport({
      message: lastUser,
      productsInContext:
        input.catalogContext?.products ?? input.lastShownProducts,
      catalogRepo: createCatalogRepository(),
      signal,
    });
    const fallback = buildCareFallbackReply(lastUser, care.focusProducts);
    return {
      kind: "llm_wrap",
      systemBlocks: [care.guidancePrompt],
      intent: "care_support",
      skipCatalogSearch: true,
      fallbackReply: fallback,
      catalogContext: input.catalogContext,
      shownProducts: input.lastShownProducts,
    };
  }

  // Pure context follow-ups that aren't care (compare/which) → let LLM use context,
  // unless it's a count/recommend that needs structured shortlist.
  const isFollowUp = isProductFollowUpQuery(lastUser);
  const wantsCount = isCatalogCountQuery(lastUser);
  const wantsRecommend =
    Boolean(journey?.experience) ||
    /\b(recommend|best\s+for|which\s+is\s+best|suggest)\b/i.test(lastUser);

  const isExplicitList = isExplicitCatalogListQuery(lastUser);
  const forceProductSearch = shouldForceProductSearch(lastUser);
  const shouldRunSearch =
    forceProductSearch ||
    !isFollowUp ||
    wantsCount ||
    wantsRecommend ||
    Boolean(journey && journey.searchQuery) ||
    isExplicitList ||
    (!isFollowUp &&
      /\b(show|find|list|browse|looking\s+for|need|want|buy|purchase|interested)\b/i.test(
        lastUser,
      ));

  if (!shouldRunSearch && isFollowUp && input.lastShownProducts?.length) {
    return { kind: "continue", intent: "product_information" };
  }

  // Social/post-purchase journeys are handled before this orchestrator.
  const merch =
    journey &&
    journey.kind !== "greeting" &&
    journey.kind !== "thanks" &&
    journey.kind !== "goodbye" &&
    journey.kind !== "order_cancel" &&
    journey.kind !== "order_modify" &&
    journey.kind !== "address_change" &&
    journey.kind !== "contact_support"
      ? journey
      : null;

  if (
    !shouldRunSearch &&
    !merch &&
    !wantsCount &&
    !forceProductSearch &&
    !/\b(show|find|list|browse|how\s+many|gloves?|mats?|bags?|guards?|balls?|products?|buy|purchase)\b/i.test(
      lastUser,
    )
  ) {
    return { kind: "continue" };
  }

  const searchService = createSearchService();
  const searchMessage = merch?.searchQuery?.trim() || lastUser;
  const result = await searchService.execute({
    message: searchMessage,
    catalogContext: input.catalogContext,
    filters: {
      budgetMax: merch?.budgetMax ?? input.catalogContext?.filters.budgetMax,
      onSaleOnly: merch?.onSaleOnly ?? input.catalogContext?.filters.onSaleOnly,
    },
    forCount: wantsCount,
    // Purchase / named-product intent must search immediately — never clarify-first.
    forceSearch: Boolean(merch) || wantsCount || forceProductSearch,
    signal,
  });

  // Dynamic clarification from live collections.
  if (result.needsClarification) {
    const options = result.followUpOptions?.length
      ? result.followUpOptions
      : result.categoryMatch.children.map((c) => c.title);
    const topic =
      result.categoryMatch.primary?.title || lastUser.trim() || "that range";
    return {
      kind: "final_reply",
      reply: buildClarificationReply(topic, options),
      intent: "product_information",
      pendingCategory: lastUser.trim(),
      catalogContext: input.catalogContext,
      searchQuery: result.canonicalSearch,
    };
  }

  let products = result.products;
  let benefits: Record<string, string> | undefined;
  let ctx = freezeSearchIntoContext(input.catalogContext, {
    canonicalSearch: result.canonicalSearch,
    products: products.slice(0, 20),
    totalCount: result.totalCount,
    department: result.department,
    category: result.category,
    subcategory: result.subcategory,
    collectionHandle: result.collectionHandle,
    collectionTitle: result.collectionTitle,
    filters: {
      budgetMax: merch?.budgetMax,
      onSaleOnly: merch?.onSaleOnly,
    },
  });

  if (result.experience || merch?.experience || merch?.budgetMax != null) {
    ctx = applyPreferenceSignals(ctx, {
      experience: result.experience ?? merch?.experience,
      budgetMax: merch?.budgetMax,
      onSaleOnly: merch?.onSaleOnly,
    });
  }

  if (wantsRecommend || merch?.experience || result.experience) {
    const picks = recommendProducts({
      products,
      preferences: ctx.preferences,
      goalText: lastUser,
      limit: SHORTLIST_DISPLAY_LIMIT,
    });
    products = picks.map((p) => p.product);
    benefits = recommendationBenefits(picks);
    ctx = {
      ...ctx,
      previousRecommendationIds: picks.map((p) => p.product.id),
      products: products.slice(0, 20),
    };
  }

  const shortlist = renderProductShortlist({
    totalCount: result.totalCount,
    products,
    benefits,
    showCount: true,
    offerMore: true,
    heading: result.collectionTitle || result.category,
  });

  if (products.length === 0 && result.totalCount === 0) {
    return {
      kind: "final_reply",
      reply: `I couldn't find any products matching product for the query "${lastUser.trim()}" in our catalog.
  
  You can try:
  • A product name (e.g. F6, T15, Kara)
  • A category (Boxing Gloves, MMA Gloves, Head Guards)
  • A feature (16oz, leather, red, beginner)
  • A use case (sparring, training, competition)
  
  I'll help you find the closest match.`,
      intent: "product_information",
      catalogContext: ctx,
      shownProducts: null,
      searchQuery: result.canonicalSearch,
      pendingCategory: result.category ?? lastUser.trim(),
    };
  }

  return {
    kind: "llm_wrap",
    systemBlocks: [shortlistWrapInstruction(shortlist)],
    intent: "product_information",
    catalogContext: ctx,
    shownProducts: products.slice(0, 20),
    searchQuery: result.canonicalSearch,
    pendingCategory: result.category ?? lastUser.trim(),
    skipCatalogSearch: true,
    fallbackReply: shortlist,
  };
}
