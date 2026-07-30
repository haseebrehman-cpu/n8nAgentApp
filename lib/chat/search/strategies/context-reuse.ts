/**
 * ContextReuseStrategy — answer follow-ups from frozen conversation products.
 */

import type {
  SearchStrategy,
  StrategyDeps,
  StrategyRequest,
  StrategyResult,
} from "@/lib/chat/search/strategies/types";
import { lookupCanonicalCache } from "@/lib/chat/search/canonical-cache";
import type { ShownProduct } from "@/lib/chat/context/product-memory";

function parsePrice(price: string | null): number | null {
  if (!price) return null;
  const n = Number(String(price).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function filterShown(
  products: ShownProduct[],
  message: string,
  filters: StrategyRequest["filters"],
): ShownProduct[] {
  let out = [...products];
  const lower = message.toLowerCase();

  if (filters.budgetMax != null) {
    out = out.filter((p) => {
      const n = parsePrice(p.price);
      return n == null || n <= filters.budgetMax!;
    });
  }
  if (filters.onSaleOnly) {
    out = out.filter((p) => p.onSale);
  }
  if (filters.availableOnly) {
    out = out.filter((p) => p.inStock !== false);
  }

  // Colour / attribute tokens in the follow-up.
  const colourMatch = lower.match(
    /\b(only\s+)?(red|blue|black|white|green|pink|yellow|orange|purple|grey|gray|gold|silver|navy|brown|camo)\b/i,
  );
  if (colourMatch?.[2]) {
    const c = colourMatch[2].toLowerCase();
    out = out.filter((p) => p.title.toLowerCase().includes(c));
  }

  if (/\bcheaper|lowest|least\s+expensive|under\b/i.test(lower)) {
    out = [...out].sort((a, b) => {
      const pa = parsePrice(a.price) ?? Number.POSITIVE_INFINITY;
      const pb = parsePrice(b.price) ?? Number.POSITIVE_INFINITY;
      return pa - pb;
    });
  }

  return out;
}

const FOLLOW_UP_RE =
  /\b(cheaper|which|compare|highest|lowest|rating|colour|color|size|oz|only|these|those|them|beginner|best\s+for|how\s+many\s+colours?)\b/i;

export const contextReuseStrategy: SearchStrategy = {
  name: "context_reuse",

  canHandle(request: StrategyRequest): boolean {
    if (!request.catalogContext?.products?.length) return false;
    // Exact canonical cache hit with same filters.
    if (
      lookupCanonicalCache(
        request.catalogContext,
        request.canonicalSearch,
        request.filters,
      )
    ) {
      return true;
    }
    // Follow-up language while context exists.
    return FOLLOW_UP_RE.test(request.message);
  },

  async execute(
    request: StrategyRequest,
    _deps: StrategyDeps,
  ): Promise<StrategyResult | null> {
    const ctx = request.catalogContext;
    if (!ctx?.products?.length) return null;

    const cached = lookupCanonicalCache(
      ctx,
      request.canonicalSearch,
      request.filters,
    );

    const base = cached?.products ?? ctx.products;
    const products = filterShown(base, request.message, request.filters);

    return {
      strategy: "context_reuse",
      products,
      totalCount: products.length,
      canonicalSearch: ctx.canonicalSearch || request.canonicalSearch,
      collectionHandle: ctx.collectionHandle,
      collectionTitle: ctx.collectionTitle,
      department: ctx.department,
      category: ctx.category,
      subcategory: ctx.subcategory,
      reusedContext: true,
    };
  },
};
