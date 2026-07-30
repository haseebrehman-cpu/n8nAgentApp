/**
 * Search Normalization Layer — collapse customer paraphrases into a stable
 * canonical search key so identical intents hit the same cache and ordering.
 */

import { tokenizeQuery } from "@/lib/chat/catalog/category-discovery";

/** Generic synonym map — attributes and modifiers, not store categories. */
const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bnon[\s-]?patterned\b/gi, "basic"],
  [/\bplain\b/gi, "basic"],
  [/\bsimple\b/gi, "basic"],
  [/\bbasic\b/gi, "basic"],
  [/\bbag\s+gloves?\b/gi, "training glove"],
  [/\bfight\s+gloves?\b/gi, "competition glove"],
  [/\bsparring\s+gloves?\b/gi, "sparring glove"],
  [/\btraining\s+gloves?\b/gi, "training glove"],
  [/\bboxing\s+gloves?\b/gi, "boxing glove"],
  [/\bhow\s+many\b/gi, ""],
  [/\bshow\s+me\b/gi, ""],
  [/\bi\s+(?:need|want|am\s+looking\s+for)\b/gi, ""],
  [/\bplease\b/gi, ""],
  [/\bproducts?\b/gi, ""],
  [/\bin\s+stock\b/gi, ""],
  [/\bavailable\b/gi, ""],
];

const GENERIC_TYPOS: Record<string, string> = {
  beginer: "beginner",
  begginer: "beginner",
  lether: "leather",
  acessories: "accessories",
  acessory: "accessory",
  colour: "color",
  colours: "color",
  colors: "color",
  glovse: "glove",
  glooves: "glove",
  glovs: "glove",
};

export function applyGenericTypos(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => {
      const key = w.toLowerCase().replace(/[^a-z0-9]/g, "");
      return GENERIC_TYPOS[key] ?? w;
    })
    .join(" ");
}

/**
 * Produce a stable canonical search string from a customer message.
 * Tokens are sorted only for the cache key's attribute tail — primary nouns
 * keep relative order for collection matching.
 */
export function normalizeCanonicalSearch(
  message: string,
  priorCanonical?: string | null,
): string {
  let text = (message || "").trim().toLowerCase();
  if (!text && priorCanonical) return priorCanonical.trim().toLowerCase();

  text = applyGenericTypos(text);
  for (const [re, replacement] of PHRASE_REPLACEMENTS) {
    text = text.replace(re, replacement);
  }

  const tokens = tokenizeQuery(text);
  // Drop pure experience/budget modifiers from the search key body — they
  // live on preferences/filters instead.
  const filtered = tokens.filter(
    (t) =>
      ![
        "beginner",
        "starter",
        "professional",
        "advanced",
        "intermediate",
        "cheap",
        "budget",
        "under",
        "below",
      ].includes(t),
  );

  const canonical = filtered.join(" ").trim();

  // Attribute-only follow-ups ("only blue", "16 oz") keep the prior search.
  const attributeOnly =
    /^(only|just|in)?\s*(red|blue|black|white|green|pink|yellow|orange|purple|grey|gray|gold|silver|navy|brown|camo|\d{1,2}\s*oz|small|medium|large|xl|xs)\s*$/i.test(
      text.trim(),
    ) ||
    (filtered.length > 0 &&
      filtered.every((t) =>
        /^(red|blue|black|white|green|pink|yellow|orange|purple|grey|gray|gold|silver|navy|brown|camo|only|just|oz|small|medium|large|xl|xs)$/i.test(
          t,
        ),
      ));

  if (attributeOnly && priorCanonical?.trim()) {
    return priorCanonical.trim().toLowerCase();
  }

  if (canonical) return canonical;

  // Empty after stripping modifiers: keep prior canonical.
  if (priorCanonical?.trim()) return priorCanonical.trim().toLowerCase();
  return tokenizeQuery(applyGenericTypos(message)).join(" ").trim();
}

/** Extract experience preference signals from free text. */
export function extractExperienceSignal(
  text: string,
): "beginner" | "intermediate" | "professional" | undefined {
  const t = text.toLowerCase();
  if (/\b(beginner|beginners|starter|new\s+to|i'?m\s+new)\b/i.test(t)) {
    return "beginner";
  }
  if (/\b(professional|pro\s+level|competition|compete|advanced)\b/i.test(t)) {
    return "professional";
  }
  if (/\b(intermediate|train\s+daily|train\s+every\s+day)\b/i.test(t)) {
    return "intermediate";
  }
  return undefined;
}
