/**
 * Shared regular expressions and phrase sets used by the intent classifiers.
 * Centralised here so the matching rules live in one place and each classifier
 * module stays focused on decision logic rather than pattern definitions.
 */

/** Phrases that mean the customer wants order tracking (not a product search). */
export const ORDER_TRACKING_INTENT_RE =
  /\b(?:track(?:\s+(?:my|this|the|an|your))?\s+order|track\s+order|order\s+(?:track(?:ing)?|status)|where(?:'?s|\s+is)\s+my\s+(?:order|package|parcel|shipment)|check(?:\s+(?:my|this|the))?\s+(?:order|shipment|package|parcel)|track(?:\s+(?:my|this|the))?\s+(?:shipment|package|parcel)|track your order)\b/i;

/**
 * Dangerous, illegal, or clearly harmful topics. "RDX" is our brand name but is
 * also a military explosive, so shoppers occasionally ask about bombs/explosives
 * (e.g. "rdx bomb", "how to make rdx"). Always refuse those and redirect. Kept
 * to unambiguous terms so real combat-sports/fitness products are never blocked.
 */
export const HARMFUL_QUERY_RE =
  /\b(bombs?|explosives?|detonat\w*|grenades?|c-?4|tnt|dynamite|ied|gunpowder|ammunition|firearms?|pistols?|rifles?|handguns?|shotguns?|silencers?|molotov|napalm|anthrax|nerve\s+agent|sarin|ricin|poison\w*|meth(?:amphetamine)?|cocaine|heroin|fentanyl|assassinat\w*|terroris\w*|how\s+to\s+(?:make|build|create)\s+(?:a\s+|an\s+|the\s+)?(?:bomb|rdx|explosive|weapon))\b/i;

/** Common single-word typos → intended browse terms (applied before search). */
export const QUERY_TYPO_MAP: Record<string, string> = {
  bosing: "boxing",
  boxng: "boxing",
  boxin: "boxing",
  boxnig: "boxing",
  glovse: "gloves",
  glooves: "gloves",
};

/**
 * Bare category browse phrases that should usually search immediately.
 * Very broad terms that need a clarifying follow-up first ("gloves",
 * "equipment", "gym equipment") are handled by needsProductClarification
 * and excluded from force-search even when listed here.
 */
export const CATEGORY_BROWSE_PHRASES = new Set<string>([
  "boxing",
  "gloves",
  "glove",
  "boxing gloves",
  "boxing glove",
  "mma",
  "mma gloves",
  "mma glove",
  "shoes",
  "boots",
  "boxing shoes",
  "boxing boots",
  "shorts",
  "wraps",
  "wrap",
  "hand wraps",
  "punch bags",
  "punch bag",
  "punching bags",
  "punching bag",
  "head guards",
  "head guard",
  "headguards",
  "headguard",
  "headgear",
  "headgears",
  "head gear",
  "boxing headgear",
  "boxing head gear",
  "boxing head guards",
  "boxing head guard",
  "mma headgear",
  "mma head guards",
  "kids headgear",
  "kids head guard",
  "kids head guards",
  "shin guards",
  "shin guard",
  "fitness",
  "yoga",
  "apparel",
  "kids",
  "sauna",
  "protein",
  "nutrition",
  "equipment",
  "accessories",
  "belts",
  "belt",
  "clothing",
  "gym equipment",
  "protection",
  "show boxing",
]);
