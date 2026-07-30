/**
 * Care / support strategy — usage, cleaning, weather, kids-safety style asks.
 * These are NOT product searches. Prefer official docs/policies; otherwise
 * give practical industry guidance.
 */

import type { ICatalogRepository } from "@/lib/chat/repositories/types";
import type { ShownProduct } from "@/lib/chat/context/product-memory";

export const CARE_INTENT_RE =
  /\b((can|could|should|will|does|is|are)\s+.+\s+(get\s+wet|wash|clean|shrink|leave\s+(it\s+)?outside|use\s+(it\s+)?(outside|outdoors|daily|every\s+day)|waterproof|water[\s-]?resistant|rain|moisture|machine[\s-]?wash|hand[\s-]?wash|dry\s+clean|kids?\s+use|beginners?\s+use)|(how\s+do\s+i\s+(wash|clean|store|care\s+for)|care\s+instructions?|cleaning\s+instructions?|storage\s+advice))\b/i;

export function isCareQuestion(text: string): boolean {
  return CARE_INTENT_RE.test(text.trim());
}

export interface CareSupportInput {
  message: string;
  productsInContext?: ShownProduct[] | null;
  catalogRepo: ICatalogRepository;
  signal?: AbortSignal;
}

export interface CareSupportResult {
  /** Evidence from policies/FAQ when available. */
  policyText: string | null;
  /** Product titles the advice is about. */
  focusProducts: string[];
  /** Instruction block for the LLM / deterministic fallback. */
  guidancePrompt: string;
}

const PRACTICAL_FALLBACK = `
If official guidance is missing, answer like an experienced store associate:
- Be warm and confident; never say only "I don't know" or "no information available".
- Use: "I couldn't find any official guidance covering that specifically, but generally…"
- Give practical industry best practices for the product type in context.
- Prefer caution for outdoor exposure, washing methods, kids use, and durability.
- Keep to short paragraphs; avoid sounding like a search engine.
`.trim();

export async function runCareSupport(
  input: CareSupportInput,
): Promise<CareSupportResult> {
  const focus = (input.productsInContext ?? []).slice(0, 3);
  const focusProducts = focus.map((p) => p.title);

  let policyText: string | null = null;
  const policyQuery = [
    input.message,
    focusProducts.length ? focusProducts.join(", ") : "",
    "care instructions cleaning storage",
  ]
    .filter(Boolean)
    .join(" — ");

  try {
    const raw = await input.catalogRepo.searchPolicies(
      policyQuery,
      input.signal,
    );
    if (raw?.trim() && !/no\s+(relevant\s+)?(results?|information)/i.test(raw)) {
      policyText = raw.trim().slice(0, 4000);
    }
  } catch {
    policyText = null;
  }

  const productLine = focusProducts.length
    ? `The customer is asking about: ${focusProducts.join("; ")}.`
    : "No specific product is selected — answer generally for this product type.";

  const guidancePrompt = `CARE / SUPPORT TURN (not a product search):
${productLine}
Customer question: "${input.message.trim()}"

${
  policyText
    ? `Official store policy / FAQ material (use this first):\n${policyText}`
    : "No official policy text was returned for this question."
}

${PRACTICAL_FALLBACK}

Never mention MCP, APIs, tools, or internal systems.
Never invent product specs (materials, IP ratings) that were not provided.
`.trim();

  return { policyText, focusProducts, guidancePrompt };
}

/** Deterministic fallback reply when the LLM path is unavailable. */
export function buildCareFallbackReply(
  message: string,
  focusProducts: string[],
): string {
  const about = focusProducts[0]
    ? `this ${focusProducts[0]}`
    : "this kind of product";

  if (/\b(wet|rain|outside|outdoor|moisture|waterproof)\b/i.test(message)) {
    return `That's a great question. We generally wouldn't recommend leaving ${about} outside in the rain. Even if the outer material can handle occasional moisture, prolonged exposure may damage the surface and allow moisture into any filling, reducing its lifespan. Unless the product specifically states it's designed for outdoor use, it's best to keep it indoors or covered when not in use.`;
  }

  if (/\b(wash|clean|cleaning)\b/i.test(message)) {
    return `I couldn't find any official guidance covering that specifically, but generally you'd want to wipe ${about} with a damp cloth and mild soap, then air-dry away from direct heat. Avoid harsh chemicals or machine washing unless the product care label says otherwise.`;
  }

  if (/\b(kids?|children)\b/i.test(message)) {
    return `It depends on the product and the child's age/size. Generally, choose gear clearly sized for kids and supervise use. If you're unsure which option fits, tell me their age or the product you're looking at and I'll help you narrow it down.`;
  }

  return `I couldn't find any official guidance covering that specifically, but generally it's best to follow the care notes on the product page when available, and treat ${about} as indoor training equipment unless it clearly says otherwise. If you share the exact product name, I can tailor this further.`;
}
