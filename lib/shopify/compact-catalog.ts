/**
 * Compact Shopify UCP catalog MCP JSON into a model-friendly payload.
 *
 * Raw MCP responses can be 100KB+ (HTML descriptions repeated on every
 * variant). That overwhelms the chat model and causes invented products /
 * wrong stock claims. We keep only the facts needed to answer shoppers.
 */

const MAX_DESCRIPTION_CHARS = 220;
const MAX_VARIANTS = 40;

interface Money {
  amount?: number | string;
  currency?: string;
}

interface RawVariant {
  id?: string;
  title?: string;
  sku?: string;
  price?: Money;
  availability?: { available?: boolean };
  options?: { name?: string; value?: string }[];
}

interface RawProduct {
  id?: string;
  title?: string;
  url?: string;
  handle?: string;
  /** Present on some Admin-shaped or extended payloads; Storefront MCP usually omits it. */
  status?: string;
  product_status?: string;
  published?: boolean;
  published_status?: string;
  description?: { html?: string; text?: string } | string;
  price_range?: { min?: Money; max?: Money };
  list_price_range?: { min?: Money; max?: Money };
  variants?: RawVariant[];
  collections?: { title?: string; handle?: string }[];
}

export interface CompactVariant {
  id?: string;
  title: string;
  available: boolean;
  price: string | null;
  sku?: string;
}

export interface CompactProduct {
  id: string;
  title: string;
  url: string | null;
  price: string | null;
  /** Present when compare-at / list price is above the current price. */
  wasPrice: string | null;
  onSale: boolean;
  inStock: boolean;
  /** Short plain-text summary for feature bullets — never full HTML. */
  summary: string | null;
  options: CompactVariant[];
  collections?: string[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSummary(description: RawProduct["description"]): string | null {
  if (!description) return null;
  let raw = "";
  if (typeof description === "string") {
    raw = description;
  } else if (typeof description.text === "string" && description.text.trim()) {
    raw = description.text;
  } else if (typeof description.html === "string") {
    raw = description.html;
  }
  const plain = stripHtml(raw);
  if (!plain) return null;
  if (plain.length <= MAX_DESCRIPTION_CHARS) return plain;
  return `${plain.slice(0, MAX_DESCRIPTION_CHARS).trim()}…`;
}

function moneyToNumber(m?: Money): number | null {
  if (!m || m.amount === undefined || m.amount === null) return null;
  const n = typeof m.amount === "number" ? m.amount : Number(m.amount);
  return Number.isFinite(n) ? n : null;
}

/** Format UCP minor-unit money (e.g. 2999 GBP → "£29.99"). */
export function formatMoney(m?: Money): string | null {
  const amount = moneyToNumber(m);
  if (amount === null) return null;
  const currency = (m?.currency || "GBP").toUpperCase();
  const major = amount / 100;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

function compactVariant(v: RawVariant): CompactVariant | null {
  const title = String(v.title ?? "").trim();
  if (!title && !v.id) return null;
  const available = Boolean(v.availability?.available);
  const out: CompactVariant = {
    title: title || "Default",
    available,
    price: formatMoney(v.price),
  };
  if (v.id) out.id = v.id;
  if (v.sku) out.sku = v.sku;
  return out;
}

const INACTIVE_STATUSES = new Set([
  "draft",
  "archived",
  "archive",
  "inactive",
  "unlisted",
  "deleted",
]);

/**
 * Keep only active / sellable catalog items. Storefront MCP normally only
 * returns published products; this still drops draft/archived/inactive if a
 * status field is present on the payload.
 */
export function isActiveCatalogProduct(raw: RawProduct): boolean {
  if (raw.published === false) return false;

  const publishedStatus = String(raw.published_status ?? "")
    .trim()
    .toLowerCase();
  if (
    publishedStatus &&
    (publishedStatus === "unpublished" ||
      publishedStatus === "draft" ||
      INACTIVE_STATUSES.has(publishedStatus))
  ) {
    return false;
  }

  const status = String(raw.status ?? raw.product_status ?? "")
    .trim()
    .toLowerCase();
  if (!status) return true;
  if (status === "active") return true;
  if (INACTIVE_STATUSES.has(status)) return false;
  // Unknown status values: keep (Storefront MCP may use other enums)
  return true;
}

export function compactProduct(raw: RawProduct): CompactProduct | null {
  if (!isActiveCatalogProduct(raw)) return null;

  const id = String(raw.id ?? "").trim();
  const title = String(raw.title ?? "").trim();
  if (!id || !title) return null;

  const variants = (raw.variants ?? [])
    .map(compactVariant)
    .filter((v): v is CompactVariant => Boolean(v))
    .slice(0, MAX_VARIANTS);

  const inStock =
    variants.length > 0
      ? variants.some((v) => v.available)
      : false;

  const priceMin = formatMoney(raw.price_range?.min);
  const listMinAmount = moneyToNumber(raw.list_price_range?.min);
  const priceMinAmount = moneyToNumber(raw.price_range?.min);
  const wasPrice =
    listMinAmount !== null &&
    priceMinAmount !== null &&
    listMinAmount > priceMinAmount &&
    listMinAmount > 0
      ? formatMoney(raw.list_price_range?.min)
      : null;

  const collections = (raw.collections ?? [])
    .map((c) => String(c.title ?? c.handle ?? "").trim())
    .filter(Boolean)
    .slice(0, 20);

  return {
    id,
    title,
    url: typeof raw.url === "string" && raw.url.trim() ? raw.url.trim() : null,
    price: priceMin,
    wasPrice,
    onSale: Boolean(wasPrice),
    inStock,
    summary: extractSummary(raw.description),
    options: variants,
    ...(collections.length ? { collections } : {}),
  };
}

/** Words that are not product-type signals in shopper queries. */
const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "of",
  "in",
  "on",
  "to",
  "with",
  "without",
  "how",
  "many",
  "much",
  "what",
  "which",
  "where",
  "do",
  "does",
  "did",
  "you",
  "we",
  "have",
  "has",
  "are",
  "is",
  "there",
  "any",
  "some",
  "all",
  "show",
  "list",
  "find",
  "get",
  "me",
  "please",
  "product",
  "products",
  "item",
  "items",
  "category",
  "categories",
  "available",
  "stock",
  "instock",
  "sale",
  "discount",
  "discounted",
  "price",
  "prices",
  "total",
  "totals",
  "count",
  "counts",
  "number",
  "matching",
  "again",
]);

/** Light English plural → singular for product nouns (vests→vest, gloves→glove). */
export function singularizeToken(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("sses") || w.endsWith("ches") || w.endsWith("shes")) {
    return w.slice(0, -2);
  }
  if (w.endsWith("ses") && w.length > 4) return w.slice(0, -1);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) {
    return w.slice(0, -1);
  }
  return w;
}

/**
 * Pull meaningful product terms from a shopper/search query.
 * Examples:
 * - "how many products in sauna vests" → ["sauna", "vest"]
 * - "boxing gloves" → ["boxing", "glove"]
 * - "shin guards" → ["shin", "guard"]
 * - "boxing headgear" → ["boxing", "head", "guard"] (store taxonomy synonym)
 */
export function extractProductTerms(query: string): string[] {
  const raw = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !QUERY_STOP_WORDS.has(t))
    .map(singularizeToken)
    .filter((t) => t.length >= 2 && !QUERY_STOP_WORDS.has(t));

  const expanded: string[] = [];
  for (const t of raw) {
    if (t === "headgear") {
      expanded.push("head", "guard");
    } else {
      expanded.push(t);
    }
  }
  return [...new Set(expanded)];
}

/**
 * Sport/nav context words that should not be required in every product title.
 * "boxing head guards" still means Head Guards (store menu), not titles that
 * literally contain "boxing".
 */
const OPTIONAL_SPORT_CONTEXT = new Set([
  "boxing",
  "mma",
  "fitness",
  "yoga",
  "training",
  "sparring",
  "competition",
]);

/** Terms used for relevance matching (after dropping optional sport context). */
export function matchTermsForQuery(query: string): string[] {
  const terms = extractProductTerms(query);
  if (terms.includes("head") && terms.includes("guard")) {
    return terms.filter((t) => !OPTIONAL_SPORT_CONTEXT.has(t));
  }
  return terms;
}

export function titleHasTermForMatch(title: string, term: string): boolean {
  const kindRe = new RegExp(
    `(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s)?([^a-z0-9]|$)`,
    "i"
  );
  return kindRe.test(title);
}

/** @deprecated use titleHasTermForMatch — kept as internal alias */
function titleHasTerm(title: string, term: string): boolean {
  return titleHasTermForMatch(title, term);
}

/**
 * Compound product names that should match multi-word category queries
 * (e.g. "Headgear" / "Headguard" for "head guards").
 */
export function expandCategoryCompoundsForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/headguards?/g, "head guard")
    .replace(/headgears?/g, "head gear")
    .replace(/shinguards?/g, "shin guard")
    .replace(/groinguards?/g, "groin guard")
    .replace(/mouthguards?/g, "mouth guard");
}

function expandCategoryCompounds(text: string): string {
  return expandCategoryCompoundsForMatch(text);
}

function textMatchesAllTerms(text: string, terms: string[]): boolean {
  const expanded = expandCategoryCompounds(text);
  return terms.every((t) => titleHasTerm(expanded, t));
}

/** Body-part modifiers that disambiguate guard categories. */
const GUARD_TYPE_MODIFIERS = new Set([
  "head",
  "shin",
  "groin",
  "mouth",
  "face",
  "chest",
  "body",
]);

/**
 * Known title patterns for multi-word categories (beyond literal term match).
 */
function matchesCategorySynonym(title: string, terms: string[]): boolean {
  const set = new Set(terms);
  if (set.has("head") && set.has("guard")) {
    return /\bhead[\s-]?gears?\b|\bheadgears?\b|\bhead[\s-]?guards?\b|\bheadguards?\b/i.test(
      title,
    );
  }
  if (set.has("sauna") && set.has("vest")) {
    return /\b(sauna|sweat)\s+vests?\b/i.test(title);
  }
  return false;
}

/**
 * Reject clear cross-category hits (e.g. shin guards in a "head guards" query)
 * even if a broad collection name matched.
 */
function isConflictingCategoryTitle(title: string, terms: string[]): boolean {
  if (!terms.includes("guard")) return false;
  const expanded = expandCategoryCompounds(title);
  const asked = terms.find((t) => GUARD_TYPE_MODIFIERS.has(t));
  if (!asked) return false;

  for (const other of GUARD_TYPE_MODIFIERS) {
    if (other === asked) continue;
    // "shin guard" / "shinguard" style — conflict unless the asked type is also present
    const otherRe = new RegExp(
      `(^|[^a-z0-9])${other}([\\s-]?guards?)?([^a-z0-9]|$)`,
      "i",
    );
    if (otherRe.test(expanded) && !titleHasTerm(expanded, asked)) {
      return true;
    }
  }
  return false;
}

function productMatchesQueryTerms(
  product: { title: string; collections?: string[] },
  terms: string[],
): boolean {
  if (isConflictingCategoryTitle(product.title, terms)) return false;

  const cols = product.collections ?? [];
  if (cols.some((c) => textMatchesAllTerms(String(c), terms))) return true;
  if (textMatchesAllTerms(product.title, terms)) return true;
  if (matchesCategorySynonym(product.title, terms)) return true;
  return false;
}

/**
 * Keep products whose title OR collection matches the query — for ANY category.
 *
 * Strategy (generic):
 * 0. Prefer products in a collection whose title/handle contains every query term
 *    (matches storefront category pages, e.g. Competition Gloves = 10 products
 *    even when titles say "Fight Gloves").
 * 1. Union with titles that contain ALL terms (or known category synonyms).
 * 2. If that yields nothing and there are 3+ terms, retry with first + last term.
 * 3. Kind-only fallback ONLY when the query has no disambiguating modifier
 *    (so "head guards" never becomes every shin/groin/mouth guard).
 * 4. If still nothing matches, return empty for known product nouns.
 */
export function filterProductsByQueryRelevance<
  T extends { title: string; collections?: string[] },
>(
  products: T[],
  query: string
): { products: T[]; filtered: boolean; kind: string | null } {
  const terms = matchTermsForQuery(query);
  if (terms.length === 0 || products.length === 0) {
    return { products, filtered: false, kind: null };
  }

  const kind = terms[terms.length - 1]!;
  const productKindTerms = new Set([
    "glove",
    "vest",
    "suit",
    "guard",
    "mat",
    "wrap",
    "bag",
    "belt",
    "shoe",
    "boot",
    "short",
    "shirt",
    "pad",
    "mitt",
    "robe",
    "helmet",
    "mask",
    "cup",
    "protector",
    "headgear",
    "gi",
  ]);

  const kindIsProductNoun = productKindTerms.has(kind);
  const hasDisambiguatingModifier =
    kind === "guard" &&
    terms.some((t) => t !== kind && GUARD_TYPE_MODIFIERS.has(t));

  let matched: T[] = [];
  if (terms.length >= 2) {
    matched = products.filter((p) => productMatchesQueryTerms(p, terms));
  }
  if (matched.length === 0 && terms.length >= 3) {
    const pair = [terms[0]!, kind];
    matched = products.filter((p) => productMatchesQueryTerms(p, pair));
  }
  if (matched.length === 0 && !hasDisambiguatingModifier) {
    // Safe kind-only fallback (e.g. "vests") — never for "head/shin/… guards".
    matched = products.filter((p) =>
      titleHasTerm(expandCategoryCompounds(p.title), kind),
    );
  }

  if (matched.length === 0) {
    // The query named a concrete product type we recognise (e.g. "shoes",
    // "boots") but nothing returned matches it — the store genuinely doesn't
    // carry that item. Report zero matches instead of falling back to the full
    // brand-matched list, which would mislabel unrelated gear as the request.
    if (kindIsProductNoun) {
      return { products: [], filtered: true, kind };
    }
    // Otherwise the "kind" is likely a modifier or brand token rather than a
    // product noun; keep the original results so the model can still help.
    return { products, filtered: false, kind };
  }

  return {
    products: matched,
    filtered: matched.length < products.length,
    kind,
  };
}

export interface CompactCatalogOptions {
  /** When set, drop search hits that don't match the product kind in the query. */
  query?: string;
  /**
   * After relevance filtering, keep at most this many products in the payload
   * (productCount still reflects the full filtered total). Useful for count
   * queries that paginated a large result set.
   */
  maxProductsInPayload?: number;
  /** True when we fetched every available search page for this query. */
  exhaustedSearch?: boolean;
  /**
   * When true, keep every product in the payload (skip title relevance
   * filtering). Active-only filtering still applies.
   */
  skipRelevanceFilter?: boolean;
}

/**
 * If `raw` is UCP catalog JSON with a `products` array (or a single `product`),
 * return a compact JSON string. Otherwise return the original text unchanged
 * (policies/FAQs, plain errors, etc.).
 */
export function compactCatalogMcpText(
  raw: string,
  options: CompactCatalogOptions = {}
): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return trimmed;

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return trimmed;
  }

  if (!data || typeof data !== "object") return trimmed;
  const obj = data as Record<string, unknown>;

  // search_catalog / lookup_catalog shape
  if (Array.isArray(obj.products)) {
    let products = (obj.products as RawProduct[])
      .filter(isActiveCatalogProduct)
      .map(compactProduct)
      .filter((p): p is CompactProduct => Boolean(p));

    const rawCount = products.length;
    let relevanceFiltered = false;
    let kind: string | null = null;

    if (options.query && !options.skipRelevanceFilter) {
      const filtered = filterProductsByQueryRelevance(products, options.query);
      products = filtered.products;
      relevanceFiltered = filtered.filtered;
      kind = filtered.kind;
    }

    const productCount = products.length;
    const maxInPayload = options.maxProductsInPayload;
    const truncated =
      typeof maxInPayload === "number" &&
      maxInPayload >= 0 &&
      products.length > maxInPayload;
    if (truncated) {
      products = products.slice(0, maxInPayload);
    }

    let hasMore = false;
    if (obj.pagination && typeof obj.pagination === "object") {
      const pag = obj.pagination as Record<string, unknown>;
      hasMore = Boolean(pag.has_next_page);
    }
    if (options.exhaustedSearch) hasMore = false;

    const result: Record<string, unknown> = {
      query: options.query ?? null,
      productCount,
      products,
      /** Search sample size before title-relevance filtering. */
      rawHitCount: rawCount,
      relevanceFiltered,
      matchedKind: kind,
      /**
       * When exhaustedSearch is true and hasMore is false, productCount is the
       * full title-filtered total for this search (any category). Otherwise it
       * is only the current page sample — never treat a page size as the total.
       */
      countIsExactCategoryTotal: Boolean(options.exhaustedSearch) && !hasMore,
      hasMore,
    };

    if (truncated) {
      result.productsShown = products.length;
      result.productsTruncated = true;
    }

    if (Array.isArray(obj.messages) && obj.messages.length > 0) {
      result.messages = obj.messages;
    }

    if (Array.isArray(obj.not_found) && obj.not_found.length > 0) {
      result.not_found = obj.not_found;
    }

    return JSON.stringify(result);
  }

  // get_product shape
  if (obj.product && typeof obj.product === "object") {
    const product = compactProduct(obj.product as RawProduct);
    if (!product) return JSON.stringify({ product: null });
    return JSON.stringify({ product });
  }

  return trimmed;
}
