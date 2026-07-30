/**
 * Conversation Context Manager — structured memory for multi-turn shopping.
 * Follow-ups reuse this cache instead of inventing a new catalog search.
 */

import type { ShownProduct } from "@/lib/chat/context/product-memory";

export type ExperienceLevel = "beginner" | "intermediate" | "professional";

export interface SearchFilters {
  budgetMax?: number;
  onSaleOnly?: boolean;
  availableOnly?: boolean;
  colour?: string;
  size?: string;
  /** Free-form attribute tokens (e.g. leather, plain, cotton). */
  attributes?: string[];
}

export interface CustomerPreferences {
  budgetMax?: number;
  experience?: ExperienceLevel;
  goals?: string[];
}

export interface ConversationCatalogContext {
  department?: string;
  category?: string;
  subcategory?: string;
  /** Normalized canonical search key for this browse/search thread. */
  canonicalSearch: string;
  matchingProductIds: string[];
  /** Sorted, deduped products frozen for this canonical search. */
  products: ShownProduct[];
  filters: SearchFilters;
  preferences: CustomerPreferences;
  previousRecommendationIds: string[];
  /** Exact unique product count for the active search (may exceed products.length). */
  totalCount: number;
  collectionHandle?: string;
  collectionTitle?: string;
  updatedAt: number;
}

export function emptyCatalogContext(
  canonicalSearch = "",
): ConversationCatalogContext {
  return {
    canonicalSearch,
    matchingProductIds: [],
    products: [],
    filters: {},
    preferences: {},
    previousRecommendationIds: [],
    totalCount: 0,
    updatedAt: Date.now(),
  };
}

export function normalizeCatalogContext(
  raw: unknown,
): ConversationCatalogContext | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<ConversationCatalogContext>;
  const canonicalSearch =
    typeof o.canonicalSearch === "string" ? o.canonicalSearch.trim() : "";
  if (!canonicalSearch && !Array.isArray(o.products)) return null;

  const products = Array.isArray(o.products)
    ? (o.products as ShownProduct[]).filter(
        (p) =>
          p &&
          typeof p === "object" &&
          typeof p.id === "string" &&
          typeof p.title === "string",
      )
    : [];

  const prefs = (o.preferences && typeof o.preferences === "object"
    ? o.preferences
    : {}) as CustomerPreferences;

  const experience =
    prefs.experience === "beginner" ||
    prefs.experience === "intermediate" ||
    prefs.experience === "professional"
      ? prefs.experience
      : undefined;

  return {
    department: typeof o.department === "string" ? o.department : undefined,
    category: typeof o.category === "string" ? o.category : undefined,
    subcategory: typeof o.subcategory === "string" ? o.subcategory : undefined,
    canonicalSearch,
    matchingProductIds: Array.isArray(o.matchingProductIds)
      ? o.matchingProductIds.filter((id): id is string => typeof id === "string")
      : products.map((p) => p.id),
    products,
    filters:
      o.filters && typeof o.filters === "object"
        ? (o.filters as SearchFilters)
        : {},
    preferences: {
      budgetMax:
        typeof prefs.budgetMax === "number" ? prefs.budgetMax : undefined,
      experience,
      goals: Array.isArray(prefs.goals)
        ? prefs.goals.filter((g): g is string => typeof g === "string")
        : undefined,
    },
    previousRecommendationIds: Array.isArray(o.previousRecommendationIds)
      ? o.previousRecommendationIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    totalCount:
      typeof o.totalCount === "number" && Number.isFinite(o.totalCount)
        ? Math.max(0, Math.floor(o.totalCount))
        : products.length,
    collectionHandle:
      typeof o.collectionHandle === "string" ? o.collectionHandle : undefined,
    collectionTitle:
      typeof o.collectionTitle === "string" ? o.collectionTitle : undefined,
    updatedAt:
      typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
        ? o.updatedAt
        : Date.now(),
  };
}

/** Merge preference/filter signals into an existing context without clearing products. */
export function applyPreferenceSignals(
  ctx: ConversationCatalogContext,
  signals: {
    budgetMax?: number;
    experience?: ExperienceLevel;
    onSaleOnly?: boolean;
    goals?: string[];
  },
): ConversationCatalogContext {
  return {
    ...ctx,
    filters: {
      ...ctx.filters,
      ...(signals.budgetMax != null ? { budgetMax: signals.budgetMax } : {}),
      ...(signals.onSaleOnly != null ? { onSaleOnly: signals.onSaleOnly } : {}),
    },
    preferences: {
      ...ctx.preferences,
      ...(signals.budgetMax != null ? { budgetMax: signals.budgetMax } : {}),
      ...(signals.experience ? { experience: signals.experience } : {}),
      ...(signals.goals?.length
        ? {
            goals: [
              ...new Set([...(ctx.preferences.goals ?? []), ...signals.goals]),
            ],
          }
        : {}),
    },
    updatedAt: Date.now(),
  };
}

export function freezeSearchIntoContext(
  previous: ConversationCatalogContext | null | undefined,
  input: {
    canonicalSearch: string;
    products: ShownProduct[];
    totalCount: number;
    department?: string;
    category?: string;
    subcategory?: string;
    collectionHandle?: string;
    collectionTitle?: string;
    filters?: SearchFilters;
  },
): ConversationCatalogContext {
  const base = previous ?? emptyCatalogContext(input.canonicalSearch);
  const products = input.products;
  return {
    ...base,
    department: input.department ?? base.department,
    category: input.category ?? base.category,
    subcategory: input.subcategory ?? base.subcategory,
    canonicalSearch: input.canonicalSearch,
    matchingProductIds: products.map((p) => p.id),
    products,
    totalCount: input.totalCount,
    collectionHandle: input.collectionHandle ?? base.collectionHandle,
    collectionTitle: input.collectionTitle ?? base.collectionTitle,
    filters: { ...base.filters, ...input.filters },
    updatedAt: Date.now(),
  };
}
