/**
 * Shared regular expressions used by intent classifiers.
 * Store taxonomy (categories/collections) is discovered dynamically — do not
 * maintain category phrase lists here.
 */

/** Phrases that mean the customer wants order tracking (not a product search). */
export const ORDER_TRACKING_INTENT_RE =
  /\b(?:track(?:\s+(?:my|this|the|an|your))?\s+order|track\s+order|order\s+(?:track(?:ing)?|status)|where(?:'?s|\s+is)\s+my\s+(?:order|package|parcel|shipment)|check(?:\s+(?:my|this|the))?\s+(?:order|shipment|package|parcel)|track(?:\s+(?:my|this|the))?\s+(?:shipment|package|parcel)|track your order)\b/i;

/**
 * Dangerous or clearly harmful topics. Brand names that collide with
 * explosives (e.g. RDX) are handled carefully — refuse bomb/explosive asks.
 */
export const HARMFUL_QUERY_RE =
  /\b(bombs?|explosives?|detonat\w*|grenades?|c-?4|tnt|dynamite|ied|gunpowder|ammunition|firearms?|pistols?|rifles?|handguns?|shotguns?|silencers?|molotov|napalm|anthrax|nerve\s+agent|sarin|ricin|poison\w*|meth(?:amphetamine)?|cocaine|heroin|fentanyl|assassinat\w*|terroris\w*|how\s+to\s+(?:make|build|create)\s+(?:a\s+|an\s+|the\s+)?(?:bomb|rdx|explosive|weapon))\b/i;

/** Generic typos → intended terms (spelling aids, not category menus). */
export const QUERY_TYPO_MAP: Record<string, string> = {
  beginer: "beginner",
  begginer: "beginner",
  lether: "leather",
  acessories: "accessories",
  acessory: "accessory",
  colour: "color",
  colours: "colors",
  glovse: "gloves",
  glooves: "gloves",
  glovs: "gloves",
  bosing: "boxing",
  boxng: "boxing",
  boxin: "boxing",
  boxnig: "boxing",
  sparrin: "sparring",
  shein: "shin",
  shinguard: "shin guard",
  headgeer: "headgear",
  mouthgaurd: "mouthguard",
  mouthgard: "mouthguard",
};

/**
 * Product series / model codes:
 * - letter-leading: F6, T15, F4R
 * - digit-leading with letters: 2W, 3G
 * Bare sizes ("14oz") and order-like numbers ("1001") are excluded — strip
 * oz-weights before testing, and require at least one letter in the token.
 */
export const PRODUCT_MODEL_CODE_RE =
  /\b(?:[a-z]{1,3}\d{1,4}[a-z]{0,3}|\d{1,3}[a-z]{1,3})\b/i;

/**
 * Common storefront product nouns. Used by browse / purchase classifiers so
 * natural language like "punching ball" is treated as shopping intent.
 */
export const PRODUCT_NOUN_RE =
  /\b(?:gloves?|bags?|guards?|headgears?|mats?|straps?|wraps?|shoes|boots|shorts?|belts?|pads?|blocks?|vests?|kits?|gear|accessories|balls?|punching\s+balls?|speed\s+balls?|mitts?|mouthguards?|helmets?|dumbbells?|kettlebells?|benches?|racks?)\b/i;

/**
 * Natural-language purchase / product-interest phrasing used by professional
 * retail chatbots ("I want to buy…", "looking to get…", "interested in…").
 */
export const PURCHASE_INTENT_RE =
  /\b(?:(?:i\s+|we\s+|i'?d\s+|we'?d\s+)?(?:want|wanna|would\s+like|like)|looking|hoping|planning|need|trying)\s+to\s+(?:buy|purchase|get|order|grab|pick\s+up)\b|\b(?:i\s+|we\s+)?(?:want|wanna|need|like)\s+(?:the|a|an|this|that|these|those|some)\b|\b(?:buy|purchase|add\s+to\s+(?:(?:my|the)\s+)?cart|check\s+out)\b|\binterested\s+in\b|\bcan\s+i\s+(?:buy|get|order|purchase)\b/i;

/**
 * @deprecated Category discovery is dynamic. Kept as empty for backward
 * compatible imports; clarification uses live collections instead.
 */
export const BROAD_TOPIC_PHRASES = new Set<string>();

/**
 * @deprecated Category browse phrases are no longer hardcoded.
 */
export const CATEGORY_BROWSE_PHRASES = new Set<string>();
