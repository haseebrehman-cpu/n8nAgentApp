import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import {
  matchTermsForQuery,
  extractProductTerms,
  filterProductsByQueryRelevance,
  rankProductsByRelevance,
} from "@/lib/shopify/compact-catalog";
import {
  normalizeSemanticQuery,
  rewriteSearchQuery,
  buildFallbackQueries,
} from "@/lib/chat/search/query-rewrite";
import { resolveCustomerJourney } from "@/lib/chat/intent/journeys";
import { resolveCatalogResponseMode } from "@/lib/chat/intent/message";
import {
  collectionMatchesQueryTerms,
  pickCategoryCollectionsFromDirectory,
} from "@/lib/shopify/storefront-collection";

const MSGS = [
  "I need sparring boxing gloves with matching wraps, head guard, mouth guard, shin guards and gym bag",
  "sparring boxing gloves with wraps head guard mouth guard shin guards gym bag",
  "Looking for sparring gloves and also need wraps, head guard, mouthguard, shin guards, gym bag",
  "sparring boxing gloves and accessories like wraps head guard mouth guard",
  "what else do I need with sparring gloves wraps head guard",
  "complete the set with wraps head guard for my gloves",
];

describe("kit / multi-product query debug", () => {
  it("writes journey, terms, ranking, collection pick", () => {
    const out: unknown[] = [];

    for (const MSG of MSGS) {
      const journey = resolveCustomerJourney(MSG);
      const normalized = normalizeSemanticQuery(MSG);
      const extract = extractProductTerms(MSG);
      const matchTerms = matchTermsForQuery(MSG);
      const rewrite = rewriteSearchQuery({ toolQuery: MSG, lastUser: MSG });
      const fallbacks = buildFallbackQueries(MSG);
      const mode = resolveCatalogResponseMode(MSG, normalized);

      const products = [
        {
          title: "RDX Sparring Boxing Gloves",
          collections: ["Boxing Gloves", "Sparring Gloves"],
        },
        {
          title: "RDX T15 Training Gloves",
          collections: ["Boxing Gloves"],
        },
        {
          title: "RDX H1 Head Guard",
          collections: ["Head Guards", "Protective Gear"],
        },
        {
          title: "RDX Kids Headguard",
          collections: ["Head Guards"],
        },
        {
          title: "RDX Hand Wraps",
          collections: ["Hand Wraps", "Accessories"],
        },
        {
          title: "RDX Mouth Guard",
          collections: ["Mouthguards"],
        },
        {
          title: "RDX Shin Guards",
          collections: ["Shin Guards"],
        },
        { title: "RDX Gym Bag", collections: ["Bags"] },
      ];

      const filtered = filterProductsByQueryRelevance(products, normalized);
      const ranked = rankProductsByRelevance(products, normalized).map((r) => ({
        title: r.product.title,
        score: Math.round(r.score),
      }));

      const directory = [
        {
          handle: "boxing-gloves",
          title: "Boxing Gloves",
          productsCount: 50,
        },
        {
          handle: "boxing-gloves-sparring",
          title: "Sparring Gloves",
          productsCount: 12,
        },
        {
          handle: "boxing-protective-gear-head-guards",
          title: "Head Guards",
          productsCount: 17,
        },
        {
          handle: "boxing-hand-wraps",
          title: "Hand Wraps",
          productsCount: 20,
        },
        {
          handle: "boxing-protective-gear-shin-guards",
          title: "Shin Guards",
          productsCount: 15,
        },
        {
          handle: "gym-bags",
          title: "Gym Bags",
          productsCount: 10,
        },
      ];

      const picked = pickCategoryCollectionsFromDirectory(
        directory,
        normalized,
      );

      out.push({
        MSG,
        journey,
        normalized,
        extract,
        matchTerms,
        rewrite,
        fallbacks,
        mode,
        filteredTitles: filtered.products.map((p) => p.title),
        filteredKind: filtered.kind,
        ranked,
        headCollectionMatchAll: collectionMatchesQueryTerms(
          "Head Guards",
          "boxing-protective-gear-head-guards",
          matchTerms,
        ),
        gloveCollectionMatchAll: collectionMatchesQueryTerms(
          "Boxing Gloves",
          "boxing-gloves",
          matchTerms,
        ),
        picked,
      });
    }

    writeFileSync(
      "lib/chat/search/kit-query-debug.out.json",
      JSON.stringify(out, null, 2),
    );
    expect(out.length).toBe(MSGS.length);
  });
});
