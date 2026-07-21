/**
 * Store category taxonomy sourced from the Online Store main menu.
 *
 * Gives the chatbot the real category tree the customer sees on the site
 * (e.g. Boxing → Boxing Gloves → Boxing Competition Gloves) instead of
 * guessing category names. Product counts come from the linked collections
 * in a single follow-up query and are cached together with the menu.
 */

import { shopifyAdminGraphql } from "@/lib/shopify/admin-client";
import { logger } from "@/lib/logger";
import {
  STATIC_MENU_DEFS,
  type StaticMenuDef,
} from "@/lib/shopify/static-menu";

export interface TaxonomyNode {
  title: string;
  /** Collection handle when the menu item links to a collection. */
  handle: string | null;
  /** Admin product count of the linked collection (approximate storefront size). */
  productCount: number | null;
  children: TaxonomyNode[];
}

export interface StoreTaxonomy {
  source: "menu" | "static";
  categories: TaxonomyNode[];
}

export interface TaxonomyFetchOptions {
  signal?: AbortSignal;
}

/** Nav noise that is not a shopping category (links, promos, theme blocks). */
const EXCLUDED_TITLE_RE =
  /^(view all|shop|login|sale|blog|wholesale|authenticator)$|gift\s*card|-image$/i;

const TAXONOMY_TTL_MS = 10 * 60 * 1000;

function staticMenuToNodes(defs: StaticMenuDef[]): TaxonomyNode[] {
  return defs.map((def) => ({
    title: def.title,
    handle: null,
    productCount: null,
    children: def.children?.length ? staticMenuToNodes(def.children) : [],
  }));
}

export interface RawMenuItem {
  title: string;
  type: string;
  resourceId: string | null;
  url: string | null;
  items?: RawMenuItem[];
}

interface MenusData {
  menus: {
    edges: {
      node: {
        handle: string;
        title: string;
        items: RawMenuItem[];
      };
    }[];
  };
}

interface CollectionCountsData {
  nodes: ({
    id: string;
    productsCount: { count: number } | null;
  } | null)[];
}

const MENU_QUERY = `
  query StoreMainMenu {
    menus(first: 10) {
      edges {
        node {
          handle
          title
          items {
            title
            type
            resourceId
            url
            items {
              title
              type
              resourceId
              url
              items {
                title
                type
                resourceId
                url
              }
            }
          }
        }
      }
    }
  }
`;

function handleFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/collections\/([a-z0-9][a-z0-9-]*)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Convert raw menu items into a clean tree: drop nav noise ("View All",
 * "Shop", gift cards, image blocks) and dedupe repeated titles per level.
 */
export function parseMenuItems(items: RawMenuItem[]): TaxonomyNode[] {
  const seen = new Set<string>();
  const nodes: TaxonomyNode[] = [];

  for (const item of items) {
    const title = item.title?.trim();
    if (!title || EXCLUDED_TITLE_RE.test(title)) continue;

    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    nodes.push({
      title,
      handle: handleFromUrl(item.url),
      productCount: null,
      children: item.items?.length ? parseMenuItems(item.items) : [],
    });
  }

  return nodes;
}

function collectResourceLookups(
  items: RawMenuItem[],
  map: Map<string, string>
): void {
  for (const item of items) {
    const title = item.title?.trim();
    if (title && !EXCLUDED_TITLE_RE.test(title) && item.resourceId) {
      map.set(title.toLowerCase(), item.resourceId);
    }
    if (item.items?.length) collectResourceLookups(item.items, map);
  }
}

function applyCounts(
  nodes: TaxonomyNode[],
  titleToGid: Map<string, string>,
  gidToCount: Map<string, number>
): void {
  for (const node of nodes) {
    const gid = titleToGid.get(node.title.toLowerCase());
    if (gid !== undefined) {
      const count = gidToCount.get(gid);
      if (typeof count === "number") node.productCount = count;
    }
    applyCounts(node.children, titleToGid, gidToCount);
  }
}

async function fetchCollectionCounts(
  gids: string[],
  options: TaxonomyFetchOptions
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (gids.length === 0) return counts;

  // nodes() accepts up to 250 ids per request; the menu stays well under that.
  const data = await shopifyAdminGraphql<CollectionCountsData>(
    `query CollectionCounts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Collection {
          id
          productsCount {
            count
          }
        }
      }
    }`,
    { ids: gids.slice(0, 250) },
    { signal: options.signal }
  );

  for (const node of data.nodes) {
    if (node?.id && typeof node.productsCount?.count === "number") {
      counts.set(node.id, node.productsCount.count);
    }
  }
  return counts;
}

function staticTaxonomy(): StoreTaxonomy {
  return {
    source: "static",
    categories: staticMenuToNodes(STATIC_MENU_DEFS),
  };
}

let cached: { taxonomy: StoreTaxonomy; expiresAt: number } | null = null;

export function __resetTaxonomyCacheForTests(): void {
  cached = null;
}

async function fetchTaxonomy(
  options: TaxonomyFetchOptions
): Promise<StoreTaxonomy> {
  const data = await shopifyAdminGraphql<MenusData>(MENU_QUERY, {}, {
    signal: options.signal,
  });

  const menus = data.menus.edges.map((e) => e.node);
  const mainMenu =
    menus.find((m) => m.handle === "main-menu") ??
    menus.reduce<(typeof menus)[number] | null>(
      (best, m) => (m.items.length > (best?.items.length ?? -1) ? m : best),
      null
    );

  if (!mainMenu || mainMenu.items.length === 0) {
    throw new Error("No usable Online Store menu found");
  }

  const categories = parseMenuItems(mainMenu.items);
  if (categories.length === 0) {
    throw new Error("Main menu parsed to an empty category tree");
  }

  const titleToGid = new Map<string, string>();
  collectResourceLookups(mainMenu.items, titleToGid);

  try {
    const gidToCount = await fetchCollectionCounts(
      [...new Set(titleToGid.values())],
      options
    );
    applyCounts(categories, titleToGid, gidToCount);
  } catch (err) {
    // Structure is still useful without counts.
    logger.warn("taxonomy", "collection counts unavailable", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { source: "menu", categories };
}

/**
 * Load the store category tree (cached ~10 minutes). Falls back to a static
 * top-level list when the menu cannot be read, so category questions still work.
 */
export async function getStoreTaxonomy(
  options: TaxonomyFetchOptions = {}
): Promise<StoreTaxonomy> {
  if (cached && cached.expiresAt > Date.now()) return cached.taxonomy;

  try {
    const taxonomy = await fetchTaxonomy(options);
    cached = { taxonomy, expiresAt: Date.now() + TAXONOMY_TTL_MS };
    return taxonomy;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || /aborted/i.test(err.message))
    ) {
      throw err;
    }
    logger.error("taxonomy", "menu fetch failed — using static fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    return staticTaxonomy();
  }
}

function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find a category or subcategory node by (fuzzy) name anywhere in the tree.
 * Top-level categories win over deeper matches with the same name.
 */
export function findTaxonomyNode(
  taxonomy: StoreTaxonomy,
  name: string
): TaxonomyNode | null {
  const target = normalizeTitle(name);
  if (!target) return null;

  const queue: TaxonomyNode[] = [...taxonomy.categories];
  let partial: TaxonomyNode | null = null;

  while (queue.length > 0) {
    const node = queue.shift()!;
    const title = normalizeTitle(node.title);
    if (title === target) return node;
    if (
      !partial &&
      target.length >= 3 &&
      (title.includes(target) || target.includes(title))
    ) {
      partial = node;
    }
    queue.push(...node.children);
  }

  return partial;
}

/** Count leaf subcategories (deepest browseable collections) under a node. */
export function countLeafSubcategories(node: TaxonomyNode): number {
  if (node.children.length === 0) return 0;
  let leaves = 0;
  for (const child of node.children) {
    leaves += child.children.length === 0 ? 1 : countLeafSubcategories(child);
  }
  return leaves;
}
