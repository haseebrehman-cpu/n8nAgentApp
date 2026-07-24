/**
 * Executes a single agent tool call against Shopify MCP / order tracking and
 * returns a model-ready string result. Owns per-tool argument handling and
 * error mapping; it does not decide when tools are called (the orchestrator
 * does) — its single responsibility is running one tool safely.
 *
 * Product catalog discovery uses Shopify Storefront MCP. Category totals that
 * match the live menu (e.g. Boxing → Head Guards = 17) are completed from the
 * public storefront collection endpoint — not Admin GraphQL.
 */

import { isConfigError } from "@/lib/config";
import { logger } from "@/lib/logger";
import { compactCatalogMcpText } from "@/lib/shopify/compact-catalog";
import {
  fetchStorefrontCollectionProducts,
  isCategoryStyleQuery,
  pickCategoryCollectionFromMcpSearch,
} from "@/lib/shopify/storefront-collection";
import { enrichSearchCatalogWithStorefront } from "@/lib/shopify/storefront-product-search";
import {
  getProduct,
  lookupCatalog,
  searchCatalog,
  searchShopPoliciesAndFaqs,
} from "@/lib/shopify/storefront-mcp";
import { OrderTrackingError, trackOrder } from "@/lib/chatbot/orderTracking";
import type { ChatAttachment } from "@/lib/types";
import type { ShopifyStoreRegion } from "@/services/shopify/credentials";
import { fetchProductSizeChart } from "@/services/shopify/productSizeChart";
import { isCatalogCountQuery, normalizeSearchQuery } from "@/lib/chat/intent";
import {
  COUNT_PAYLOAD_PRODUCTS,
  COUNT_SEARCH_LIMIT,
  SEARCH_RESULT_LIMIT,
} from "@/lib/chat/agent/config";
import { wrapMcpResult } from "@/lib/chat/agent/mcp-format";
import { searchCatalogForCount } from "@/lib/chat/agent/catalog-count";

export interface RunToolOptions {
  region?: ShopifyStoreRegion;
  signal?: AbortSignal;
  lastUser?: string;
  /**
   * Called when get_size_chart resolves a verified chart. The model never sees
   * the raw image URL — only this callback receives it for the HTTP response.
   */
  onSizeChartAttachment?: (attachment: ChatAttachment) => void;
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  options: RunToolOptions,
): Promise<string> {
  try {
    if (name === "search_catalog") {
      const query = normalizeSearchQuery(String(args.query ?? ""));
      if (!query) return JSON.stringify({ error: "query is required" });

      const counting =
        args.forCount === true ||
        args.forCount === "true" ||
        isCatalogCountQuery(options.lastUser ?? "") ||
        isCatalogCountQuery(query);

      const limitRaw = Number(args.limit);
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.min(Math.floor(limitRaw), 50)
          : counting
            ? COUNT_SEARCH_LIMIT
            : SEARCH_RESULT_LIMIT;

      // Include out-of-stock by default so counts and lists match full inventory.
      // Only filter to in-stock when the customer asks, or the model sets availableOnly.
      const wantInStockOnly = /\b(in\s+stock|available\s+only)\b/i.test(
        options.lastUser ?? "",
      );
      const availableOnly =
        wantInStockOnly ||
        args.availableOnly === true ||
        args.availableOnly === "true";

      // Counts and category-style queries: prefer the matching storefront
      // collection when MCP surfaces one (accurate category totals). Use one MCP
      // page first so Vercel stays under the function budget; only paginate MCP
      // when counting and no collection was found.
      const preferCollection = counting || isCategoryStyleQuery(query);

      if (preferCollection) {
        const firstPage = await searchCatalog(
          {
            query,
            pagination: { limit: COUNT_SEARCH_LIMIT },
            filters: { available: availableOnly },
          },
          { signal: options.signal },
        );

        const picked = pickCategoryCollectionFromMcpSearch(firstPage, query);
        if (picked) {
          try {
            const collectionRaw = await fetchStorefrontCollectionProducts(
              picked.handle,
              {
                signal: options.signal,
                availableOnly,
                collectionTitle: picked.title,
              },
            );
            return wrapMcpResult(
              compactCatalogMcpText(collectionRaw, {
                query,
                skipRelevanceFilter: true,
                exhaustedSearch: true,
                maxProductsInPayload: counting
                  ? COUNT_PAYLOAD_PRODUCTS
                  : undefined,
              }),
              counting
                ? `COLLECTION COUNT: productCount is the live storefront collection total for "${picked.title}" (${picked.handle}) — use THAT number for an explicit 'how many' (matches the website category page). Includes out-of-stock unless in-stock-only was requested. Do NOT list products unless asked. Never invent products or stock.`
                : `COLLECTION RESULTS: products from the live storefront collection "${picked.title}" (${picked.handle}). Act like a sales advisor: DON'T dump the whole list or lead with a raw count. Recommend the best 3 (max 5) that fit what the customer asked for, each with a short reason why. Offer to show more or narrow by size/colour/budget. Never invent products or stock.`,
            );
          } catch (err) {
            logger.warn(
              "chat-agent",
              "storefront collection fetch failed; using MCP search filter",
              {
                query,
                handle: picked.handle,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }
        }

        // No collection (or storefront failed): full MCP pagination only for counts.
        if (counting) {
          const { raw, exhausted } = await searchCatalogForCount(
            query,
            availableOnly,
            { signal: options.signal },
          );
          const enrichedPaginated = await enrichSearchCatalogWithStorefront(
            raw,
            query,
            { signal: options.signal },
          );
          return wrapMcpResult(
            compactCatalogMcpText(enrichedPaginated, {
              query,
              exhaustedSearch: exhausted,
              maxProductsInPayload: COUNT_PAYLOAD_PRODUCTS,
            }),
            "COUNT MODE (MCP): productCount is the title/collection-filtered total of ACTIVE catalog products across paginated search_catalog results (including out-of-stock unless availableOnly was true; never draft/archived/inactive) — use THAT number ONLY for an explicit 'how many' / total answer. Do NOT use the default page size (10) or productsShown as the total. If countIsExactCategoryTotal is true, state the number confidently. If hasMore is true, say you found at least productCount matching items. Do NOT list products unless they asked to see them. Never invent products or stock.",
          );
        }

        const enrichedFirst = await enrichSearchCatalogWithStorefront(
          firstPage,
          query,
          { signal: options.signal },
        );
        return wrapMcpResult(
          compactCatalogMcpText(enrichedFirst, { query }),
          "CATEGORY / LIST MODE (MCP): ACTIVE products from search_catalog, relevance-filtered (never draft/archived/inactive). Respond like a sales advisor: DON'T dump the whole list and DON'T lead with a raw count (the customer didn't ask 'how many'). Recommend the best 3 (max 5) matches for their need, each with a one-line reason why it fits. Then offer to show more or narrow by size/colour/budget. Includes out-of-stock unless filtered. Never invent products or stock.",
        );
      }

      const data = await searchCatalog(
        {
          query,
          pagination: { limit },
          filters: { available: availableOnly },
        },
        { signal: options.signal },
      );
      const enriched = await enrichSearchCatalogWithStorefront(data, query, {
        signal: options.signal,
      });
      return wrapMcpResult(
        compactCatalogMcpText(enriched, { query }),
        "Live search results (compacted + title-filtered for EVERY query). Respond like a sales advisor, not a search engine: recommend the best 3 (max 5) products that fit what the customer asked for, each with a short reason why, then offer a natural next step (details, sizing, or narrowing by colour/budget). DON'T dump the whole list and DON'T lead with a raw count — productCount is only for an explicit 'how many' question (prefer forCount/limit 50 so counts are not capped). Do NOT count unrelated hits that were dropped. The products array already excludes unrelated hits — only mention products that appear in it. If productCount is 0 (empty products array) the store does not carry the item they asked for, even if rawHitCount is higher: say plainly we don't carry it, name what we DO sell, and offer to help — do NOT list the dropped hits or pretend they match. Never invent products or stock.",
      );
    }

    if (name === "get_product") {
      const id = String(args.id ?? "").trim();
      if (!id) return JSON.stringify({ error: "id is required" });

      const data = await getProduct({ id }, { signal: options.signal });
      return wrapMcpResult(
        compactCatalogMcpText(data),
        "Full details for this product (compacted). Use ONLY these facts (price, options/availability, link). A product is in stock when inStock is true or any option has available:true. Never invent details.",
      );
    }

    if (name === "get_size_chart") {
      const id = String(args.id ?? "").trim();
      if (!id) return JSON.stringify({ error: "id is required" });

      const chart = await fetchProductSizeChart(id, {
        region: options.region,
        signal: options.signal,
      });

      if (!chart) {
        return JSON.stringify({
          found: false,
          productId: id,
          message:
            "No verified size chart is available for this product. Tell the customer honestly and offer to help with available sizes/variants from get_product, or suggest another product.",
        });
      }

      options.onSizeChartAttachment?.({
        kind: "size_chart",
        productId: chart.productId,
        productTitle: chart.productTitle,
        url: chart.url,
        altText: chart.altText,
        width: chart.width,
        height: chart.height,
      });

      // Never include the image URL in model-visible tool output.
      return JSON.stringify({
        found: true,
        productId: chart.productId,
        productTitle: chart.productTitle,
        hasImage: true,
        width: chart.width,
        height: chart.height,
        message:
          "A verified size-chart image will be shown to the customer below your reply. Briefly confirm the product name, give any short sizing tips you already know from catalog data, and say the size chart is below. Do NOT paste, invent, or mention any image URL.",
      });
    }

    if (name === "lookup_catalog") {
      const ids = Array.isArray(args.ids)
        ? args.ids.map((x) => String(x).trim()).filter(Boolean)
        : [];
      if (ids.length === 0) return JSON.stringify({ error: "ids is required" });

      const data = await lookupCatalog({ ids }, { signal: options.signal });
      return wrapMcpResult(
        compactCatalogMcpText(data),
        "Products/variants resolved by id (compacted). Use ONLY these facts. Never invent details.",
      );
    }

    if (name === "search_shop_policies_and_faqs") {
      const query = String(args.query ?? "").trim();
      if (!query) return JSON.stringify({ error: "query is required" });

      const data = await searchShopPoliciesAndFaqs(
        { query },
        { signal: options.signal },
      );
      return wrapMcpResult(
        data,
        "Store policy / FAQ answer. Answer the customer using ONLY this content — do not add outside information. If it does not clearly answer the question, say you're not certain and offer to help another way (e.g. order tracking).",
      );
    }

    if (name === "track_order") {
      const orderNumber = String(args.orderNumber ?? "").trim();
      const email = String(args.email ?? "").trim();
      if (!orderNumber) {
        return JSON.stringify({ error: "orderNumber is required" });
      }
      if (!email) {
        return JSON.stringify({ error: "email is required" });
      }
      const result = await trackOrder(orderNumber, {
        email,
        region: options.region,
        signal: options.signal,
      });
      return JSON.stringify({
        ...result,
        hint: "Reply to the customer using the message field. Do not invent tracking details.",
      });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err) {
    if (err instanceof OrderTrackingError) {
      return JSON.stringify({ error: err.message });
    }
    if (isConfigError(err)) {
      logger.error("chat-agent", `tool "${name}" config error`, {
        error: err.message,
      });
      return JSON.stringify({
        error:
          "The store connection is not ready yet. Apologize and say the service is temporarily unavailable.",
      });
    }
    logger.error("chat-agent", `tool "${name}" failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return JSON.stringify({
      error:
        "The lookup failed. Apologize and ask the customer to try again shortly.",
    });
  }
}
