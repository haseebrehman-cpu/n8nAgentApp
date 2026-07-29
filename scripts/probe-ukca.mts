import { readFileSync, writeFileSync } from "fs";

// Load .env without dotenv dependency
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  const key = m[1]!.trim();
  const val = m[2]!.trim();
  if (!process.env[key]) process.env[key] = val;
}

import { getStoreCollections } from "../lib/shopify/collection-directory.ts";
import {
  resolveCategoryCollections,
  fetchStorefrontCollectionsMerged,
} from "../lib/shopify/storefront-collection.ts";
import { searchCatalog } from "../lib/shopify/storefront-mcp.ts";
import { compactCatalogMcpText } from "../lib/shopify/compact-catalog.ts";
import { searchCatalogForCount } from "../lib/chat/agent/catalog-count.ts";
import { runTool } from "../lib/chat/agent/tool-runner.ts";

const lines: string[] = [];
function log(...args: unknown[]) {
  const s = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2)))
    .join(" ");
  lines.push(s);
  console.log(s);
}

async function main() {
  const dir = await getStoreCollections();
  const ukca = dir.filter((c) =>
    /ukca|certif/i.test(c.title + " " + c.handle),
  );
  log(
    "UKCA collections:",
    ukca.map((c) => ({
      handle: c.handle,
      title: c.title,
      count: c.productsCount,
    })),
  );

  for (const query of ["ukca certified products", "ukca", "ukca certified"]) {
    log("\n==== QUERY:", query);
    const firstPage = await searchCatalog(
      { query, pagination: { limit: 50 }, filters: { available: false } },
      {},
    );
    const picked = await resolveCategoryCollections(query, firstPage);
    log(
      "picked",
      picked.map((p) => ({
        handle: p.handle,
        title: p.title,
        score: p.score,
        hitCount: p.hitCount,
      })),
    );

    if (picked.length) {
      const merged = await fetchStorefrontCollectionsMerged(
        picked.map((c) => ({ handle: c.handle, title: c.title })),
        { availableOnly: false },
      );
      const skip = JSON.parse(
        compactCatalogMcpText(merged, {
          query,
          skipRelevanceFilter: true,
          exhaustedSearch: true,
          maxProductsInPayload: 20,
        }),
      );
      const filt = JSON.parse(
        compactCatalogMcpText(merged, {
          query,
          exhaustedSearch: true,
          maxProductsInPayload: 20,
        }),
      );
      log("collection skipFilter", {
        count: skip.productCount,
        titles: skip.products.map((p: { title: string }) => p.title),
      });
      log("collection withFilter", {
        count: filt.productCount,
        relevanceFiltered: filt.relevanceFiltered,
        titles: filt.products.map((p: { title: string }) => p.title),
      });
    }

    const { raw, exhausted } = await searchCatalogForCount(query, false, {});
    const pag = JSON.parse(
      compactCatalogMcpText(raw, {
        query,
        exhaustedSearch: exhausted,
        maxProductsInPayload: 20,
      }),
    );
    log("MCP paginated", {
      count: pag.productCount,
      exact: pag.countIsExactCategoryTotal,
      rawHit: pag.rawHitCount,
      filtered: pag.relevanceFiltered,
      titles: pag.products.map((p: { title: string }) => p.title),
    });
  }

  // Simulate agent tool calls for the two user turns
  log("\n==== runTool category browse");
  const r1 = await runTool(
    "search_catalog",
    { query: "ukca certified products" },
    { lastUser: "ukca certified products" },
  );
  log(r1.slice(0, 2500));

  log("\n==== runTool list all");
  const r2 = await runTool(
    "search_catalog",
    { query: "ukca certified products" },
    { lastUser: "list all" },
  );
  log(r2.slice(0, 2500));

  writeFileSync("probe-ukca-out.txt", lines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
