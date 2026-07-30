/**
 * Recommendation Engine — preference-aware ranking over a product set.
 * Returns structured picks; Response layer renders cards.
 */

import type {
  CustomerPreferences,
  ExperienceLevel,
} from "@/lib/chat/context/conversation-context";
import type { ShownProduct } from "@/lib/chat/context/product-memory";
import { normalizeProductOrdering } from "@/lib/chat/search/ranking";

export interface RecommendationPick {
  product: ShownProduct;
  reason: string;
  score: number;
}

export interface RecommendInput {
  products: ShownProduct[];
  preferences?: CustomerPreferences;
  goalText?: string;
  limit?: number;
}

function parsePrice(price: string | null): number | null {
  if (!price) return null;
  const n = Number(String(price).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function experienceBoost(title: string, level?: ExperienceLevel): number {
  const t = title.toLowerCase();
  if (level === "beginner") {
    if (/\b(beginner|starter|entry|basic|training)\b/i.test(t)) return 25;
    if (/\b(pro|competition|fight|elite|professional)\b/i.test(t)) return -15;
    return 5;
  }
  if (level === "professional") {
    if (/\b(pro|competition|fight|elite|professional|contest)\b/i.test(t)) {
      return 25;
    }
    if (/\b(beginner|starter|kids?|junior)\b/i.test(t)) return -15;
    return 5;
  }
  if (level === "intermediate") {
    if (/\b(training|durable|everyday|daily)\b/i.test(t)) return 15;
    return 0;
  }
  return 0;
}

function reasonFor(
  product: ShownProduct,
  preferences?: CustomerPreferences,
): string {
  if (preferences?.experience === "beginner") {
    return "A solid choice if you're just getting started";
  }
  if (preferences?.experience === "professional") {
    return "Built for higher-intensity / competitive use";
  }
  if (preferences?.budgetMax != null && product.price) {
    const n = parsePrice(product.price);
    if (n != null && n <= preferences.budgetMax) {
      return `Fits your budget (under ${preferences.budgetMax})`;
    }
  }
  if (product.onSale) return "Good value — currently on sale";
  if (product.inStock === true) return "In stock and ready when you are";
  return "A strong match from the options we looked at";
}

export function recommendProducts(input: RecommendInput): RecommendationPick[] {
  const limit = input.limit ?? 3;
  const prefs = input.preferences ?? {};
  const goal = (input.goalText ?? "").toLowerCase();

  const scored = input.products.map((product, index) => {
    let score = 100 - index;
    score += experienceBoost(product.title, prefs.experience);

    if (prefs.budgetMax != null) {
      const n = parsePrice(product.price);
      if (n != null && n <= prefs.budgetMax) score += 10;
      if (n != null && n > prefs.budgetMax) score -= 40;
    }

    if (/\b(daily|every\s+day|durable)\b/i.test(goal)) {
      if (/\b(training|durable|pro)\b/i.test(product.title)) score += 12;
    }

    if (product.inStock === true) score += 5;
    if (product.inStock === false) score -= 20;
    if (product.onSale) score += 3;

    return {
      product,
      score,
      reason: reasonFor(product, prefs),
      id: product.id,
      title: product.title,
      handle: undefined as string | undefined,
      url: product.url,
      relevanceScore: score,
    };
  });

  const ordered = normalizeProductOrdering(scored).slice(0, limit);

  return ordered.map((row) => ({
    product: row.product,
    reason: row.reason,
    score: row.score,
  }));
}

export function recommendationBenefits(
  picks: RecommendationPick[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pick of picks) {
    out[pick.product.id] = pick.reason;
  }
  return out;
}
