import { it } from "vitest";

process.env.SHOPIFY_STORE_DOMAIN = "rdx-sports-store.myshopify.com";
process.env.SHOPIFY_STOREFRONT_URL = "https://rdx-sports-store.myshopify.com";
process.env.SHOPIFY_MARKET_COUNTRY = "GB";
process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_dummy";
delete process.env.REDIS_URL;

const QUERIES = [
  "kids boxing sets",
  "boxing gloves",
  "kids boxing gloves",
  "punch bags",
  "head guards",
  "shin guards",
  "mma gloves",
  "iconic gear",
];

it(
  "probe",
  async () => {
    const { normalizeSearchQuery, resolveCatalogResponseMode } = await import(
      "@/lib/chat/intent"
    );
    const { resolveCategoryCollections, fetchStorefrontCollectionsMerged } =
      await import("@/lib/shopify/storefront-collection");
    const { searchCatalog } = await import("@/lib/shopify/storefront-mcp");
    const { compactCatalogMcpText } = await import(
      "@/lib/shopify/compact-catalog"
    );

    for (const userMsg of QUERIES) {
      const query = normalizeSearchQuery(userMsg);
      const mode = resolveCatalogResponseMode(userMsg, query);
      const firstPage = await searchCatalog(
        { query, pagination: { limit: 50 }, filters: { available: false } },
        {},
      );
      const picked = await resolveCategoryCollections(query, firstPage);
      if (picked.length === 0) {
        console.log(`\n### "${userMsg}" (${mode}) -> NO COLLECTION`);
        continue;
      }
      const merged = await fetchStorefrontCollectionsMerged(
        picked.map((c) => ({ handle: c.handle, title: c.title })),
        { availableOnly: false },
      );
      const out = JSON.parse(
        compactCatalogMcpText(merged, {
          query,
          skipRelevanceFilter: true,
          exhaustedSearch: true,
          maxProductsInPayload: 3,
        }),
      );
      console.log(
        `\n### "${userMsg}" (${mode}) -> ${picked.map((p) => p.handle).join(", ")}  productCount=${out.productCount} exact=${out.countIsExactCategoryTotal}`,
      );
      console.log(
        "   ",
        out.products.map((p: { title: string }) => p.title).join("\n    "),
      );
      await new Promise((r) => setTimeout(r, 600));
    }
  },
  300_000,
);
