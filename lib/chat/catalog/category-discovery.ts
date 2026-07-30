/**
 * Dynamic Category Discovery — match customer language to live Shopify
 * collections. No hardcoded category lists; new store collections work
 * automatically.
 */

import {
  isMarketingCollection,
  queryRequestsMarketingCollection,
} from "@/lib/shopify/collection-directory";
import type { CollectionRef } from "@/lib/chat/repositories/types";
import type { ICollectionRepository } from "@/lib/chat/repositories/types";

export interface DiscoveredCategory {
  handle: string;
  title: string;
  productsCount: number;
  score: number;
  /** Parent department inferred from handle/title prefix when possible. */
  department?: string;
}

export interface CategoryMatchResult {
  /** Best matching collections (highest score first). */
  matches: DiscoveredCategory[];
  /** Child / sibling collections under the best match for follow-up prompts. */
  children: DiscoveredCategory[];
  /** True when the query is a single broad token that needs clarification. */
  needsClarification: boolean;
  /** Top match, if any. */
  primary: DiscoveredCategory | null;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "of",
  "to",
  "in",
  "on",
  "with",
  "my",
  "me",
  "i",
  "we",
  "you",
  "your",
  "our",
  "show",
  "find",
  "get",
  "need",
  "want",
  "looking",
  "buy",
  "please",
  "some",
  "any",
  "all",
  "how",
  "many",
  "much",
  "what",
  "which",
  "are",
  "is",
  "do",
  "does",
  "can",
  "have",
  "has",
  "products",
  "product",
  "items",
  "item",
  "category",
  "collection",
  "available",
  "stock",
]);

/** Generic synonym collapse — not store-specific categories. */
const TOKEN_SYNONYMS: Record<string, string> = {
  mats: "mat",
  straps: "strap",
  gloves: "glove",
  bags: "bag",
  blocks: "block",
  wraps: "wrap",
  guards: "guard",
  shoes: "shoe",
  boots: "boot",
  belts: "belt",
  kids: "kid",
  children: "kid",
  childrens: "kid",
  child: "kid",
  colours: "color",
  colour: "color",
  colors: "color",
  plain: "basic",
  simple: "basic",
  nonpatterned: "basic",
  sparring: "sparring",
  training: "training",
  fight: "competition",
  competing: "competition",
  compete: "competition",
};

export function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
    .map((t) => TOKEN_SYNONYMS[t] ?? t);
}

function singularize(token: string): string {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("ses") || token.endsWith("xes") || token.endsWith("zes")) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function collectionTokens(title: string, handle: string): string[] {
  const hay = `${title} ${handle.replace(/-/g, " ")}`.toLowerCase();
  return tokenizeQuery(hay).map(singularize);
}

function scoreCollection(
  col: CollectionRef,
  queryTokens: string[],
  allowMarketing: boolean,
): number {
  if (
    isMarketingCollection(col.title, col.handle) &&
    !allowMarketing
  ) {
    return -1;
  }
  if (queryTokens.length === 0) return 0;

  const colTokens = collectionTokens(col.title, col.handle);
  const colSet = new Set(colTokens);
  const titleLower = col.title.toLowerCase();
  const handleLower = col.handle.toLowerCase().replace(/-/g, " ");

  let score = 0;
  let hits = 0;
  for (const qt of queryTokens) {
    const s = singularize(qt);
    if (colSet.has(s) || colSet.has(qt)) {
      hits += 1;
      score += 20;
    } else if (titleLower.includes(s) || handleLower.includes(s)) {
      hits += 1;
      score += 12;
    }
  }

  if (hits === 0) return 0;
  if (hits === queryTokens.length) score += 50;

  // Prefer tighter titles (fewer extra tokens).
  const extra = colTokens.filter(
    (t) => !queryTokens.map(singularize).includes(t),
  ).length;
  score -= extra * 4;

  // Exact title phrase bonus.
  const phrase = queryTokens.join(" ");
  if (titleLower === phrase || titleLower.replace(/&/g, "and") === phrase) {
    score += 100;
  }

  return score;
}

function inferDepartment(handle: string, title: string): string | undefined {
  const parts = handle.split("-").filter(Boolean);
  if (parts.length >= 2) return parts[0];
  const words = title.split(/\s+/).filter(Boolean);
  return words[0]?.toLowerCase();
}

/**
 * Match a customer query against the live collection directory.
 */
export function matchCollections(
  query: string,
  collections: CollectionRef[],
): CategoryMatchResult {
  const queryTokens = tokenizeQuery(query).map(singularize);
  const allowMarketing = queryRequestsMarketingCollection(query);

  const scored: DiscoveredCategory[] = [];
  for (const col of collections) {
    const score = scoreCollection(col, queryTokens, allowMarketing);
    if (score <= 0) continue;
    scored.push({
      handle: col.handle,
      title: col.title,
      productsCount: col.productsCount,
      score,
      department: inferDepartment(col.handle, col.title),
    });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.title.localeCompare(b.title, "en") ||
      a.handle.localeCompare(b.handle, "en"),
  );

  const matches = scored.slice(0, 12);
  const primary = matches[0] ?? null;

  // Children: other matches that share department/prefix with primary.
  let children: DiscoveredCategory[] = [];
  if (primary) {
    const dept = primary.department;
    children = matches
      .filter((m) => m.handle !== primary.handle)
      .filter((m) => {
        if (dept && m.department === dept) return true;
        // Handle nesting: primary handle is prefix of child.
        return (
          m.handle.startsWith(`${primary.handle}-`) ||
          primary.handle.startsWith(`${m.handle}-`)
        );
      })
      .slice(0, 8);

    // If no hierarchical children, offer other strong sibling matches.
    if (children.length === 0 && matches.length > 1) {
      children = matches.slice(1, 6);
    }
  }

  // Ultra-broad: one content token with multiple related collections → clarify.
  // Exact title matches still clarify when children/siblings exist (e.g. "Boxing").
  const needsClarification =
    queryTokens.length <= 1 &&
    matches.length >= 2 &&
    (children.length >= 1 || matches.length >= 3);

  return { matches, children, needsClarification, primary };
}

/** Discover categories for a query using the collection repository. */
export async function discoverCategories(
  query: string,
  repo: ICollectionRepository,
  signal?: AbortSignal,
): Promise<CategoryMatchResult> {
  const collections = await repo.listCollections(signal);
  return matchCollections(query, collections);
}

/**
 * Build dynamic follow-up option labels from child/sibling collections.
 */
export function followUpOptionsFromChildren(
  children: DiscoveredCategory[],
  limit = 6,
): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const child of children) {
    const label = child.title.trim();
    const key = label.toLowerCase();
    // Never offer Iconic Range / Iconic Gear as a default follow-up.
    if (!label || seen.has(key) || /\biconic\b/i.test(label)) continue;
    seen.add(key);
    options.push(label);
    if (options.length >= limit) break;
  }
  return options;
}
