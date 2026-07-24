/**
 * Executes a single agent tool call against Shopify MCP / order tracking and
 * returns a model-ready string result. Owns per-tool argument handling and
 * error mapping; it does not decide when tools are called (the orchestrator
 * does) — its single responsibility is running one tool safely.
 *
 * Product catalog discovery uses Shopify Storefront MCP. Category totals that
 * match the live menu (e.g. Boxing → Head Guards = 17) are completed from the
 * public storefront collection endpoint — not Admin GraphQL. Parent category
 * queries (e.g. boxing gloves) merge every matching subcategory collection so
 * productCount is the full category total.
 * Exact unit quantities use Admin GraphQL via get_inventory.
 */

import { isConfigError } from "@/lib/config";
import { logger } from "@/lib/logger";
import { compactCatalogMcpText } from "@/lib/shopify/compact-catalog";
import {
  fetchStorefrontCollectionsMerged,
  isCategoryStyleQuery,
  pickCategoryCollectionsFromMcpSearch,
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
import {
  fetchInventoryByIds,
  fetchProductInventory,
} from "@/services/shopify/productInventory";
import {
  isCatalogCountQuery,
  normalizeSearchQuery,
  resolveCatalogResponseMode,
  type CatalogResponseMode,
} from "@/lib/chat/intent";
import {
  CATEGORY_PAYLOAD_PRODUCTS,
  COUNT_SEARCH_LIMIT,
  LIST_PAYLOAD_PRODUCTS,
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

function payloadCapForMode(mode: CatalogResponseMode): number | undefined {
  if (mode === "list") return LIST_PAYLOAD_PRODUCTS;
  if (mode === "category") return CATEGORY_PAYLOAD_PRODUCTS;
  return undefined;
}

function hintForMode(
  mode: CatalogResponseMode,
  collectionLabel?: string,
): string {
  if (mode === "list") {
    const scope = collectionLabel
      ? ` from the live storefront collection ${collectionLabel}`
      : "";
    return `LIST MODE${scope}: productCount is the category total (exact when countIsExactCategoryTotal is true; otherwise say "at least productCount"). Show at most ${LIST_PAYLOAD_PRODUCTS} products from the products array (name, price, stock status, URL only). If productsTruncated is true or productCount > productsShown, clearly say you are showing the first ${LIST_PAYLOAD_PRODUCTS} only. Never return more than ${LIST_PAYLOAD_PRODUCTS}. Never invent products or stock.`;
  }

  if (mode === "category") {
    const scope = collectionLabel
      ? ` from the live storefront collection ${collectionLabel}`
      : "";
    return `CATEGORY MODE${scope}: productCount is the category total (exact when countIsExactCategoryTotal is true; otherwise say "at least productCount"). Reply with the total and up to ${CATEGORY_PAYLOAD_PRODUCTS} products from the products array — each with name, price, stock status, and URL only. Then invite the customer to narrow by model, size, weight, material, or use. Never invent products or stock.`;
  }

  if (mode === "specific") {
    return `SPECIFIC PRODUCT MODE: Prefer the best title match. If the customer asked about one product, call get_product with its id and reply with details for that product only — do not shortlist unrelated alternatives. Never invent products or stock.`;
  }

  return `Live search results (compacted + title-filtered). Recommend the best 3 (max 5) that fit what the customer asked for, each with a short reason, then offer a natural next step. DON'T dump the whole list. productCount is only an exact total when countIsExactCategoryTotal is true. Never invent products or stock.`;
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

      const mode = resolveCatalogResponseMode(options.lastUser ?? "", query);
      const needsExactTotal = mode === "category" || mode === "list";
      const payloadCap = payloadCapForMode(mode);

      const counting =
        needsExactTotal ||
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
            : mode === "specific"
              ? 3
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

      const preferCollection =
        needsExactTotal || counting || isCategoryStyleQuery(query);

      if (preferCollection) {
        const firstPage = await searchCatalog(
          {
            query,
            pagination: { limit: COUNT_SEARCH_LIMIT },
            filters: { available: availableOnly },
          },
          { signal: options.signal },
        );

        const picked = pickCategoryCollectionsFromMcpSearch(firstPage, query);
        if (picked.length > 0) {
          try {
            const collectionRaw = await fetchStorefrontCollectionsMerged(
              picked.map((c) => ({ handle: c.handle, title: c.title })),
              {
                signal: options.signal,
                availableOnly,
              },
            );
            const label =
              picked.length === 1
                ? `"${picked[0]!.title}" (${picked[0]!.handle})`
                : `${picked.length} subcategory collections under "${picked[0]!.title}" (total across all matching subcategories)`;
            return wrapMcpResult(
              compactCatalogMcpText(collectionRaw, {
                query,
                skipRelevanceFilter: true,
                exhaustedSearch: true,
                maxProductsInPayload: payloadCap,
              }),
              hintForMode(mode === "generic" ? "category" : mode, label),
            );
          } catch (err) {
            logger.warn(
              "chat-agent",
              "storefront collection fetch failed; using MCP search filter",
              {
                query,
                handles: picked.map((c) => c.handle),
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }
        }

        // Exact totals without a collection: paginate MCP for category/list/count.
        if (needsExactTotal || counting) {
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
          const effectiveMode: CatalogResponseMode =
            mode === "list" ? "list" : "category";
          return wrapMcpResult(
            compactCatalogMcpText(enrichedPaginated, {
              query,
              exhaustedSearch: exhausted,
              maxProductsInPayload: payloadCap ?? CATEGORY_PAYLOAD_PRODUCTS,
            }),
            hintForMode(effectiveMode),
          );
        }

        const enrichedFirst = await enrichSearchCatalogWithStorefront(
          firstPage,
          query,
          { signal: options.signal },
        );
        return wrapMcpResult(
          compactCatalogMcpText(enrichedFirst, {
            query,
            maxProductsInPayload: payloadCap,
          }),
          hintForMode(mode),
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
        compactCatalogMcpText(enriched, {
          query,
          maxProductsInPayload: payloadCap,
        }),
        hintForMode(mode),
      );
    }

    if (name === "get_product") {
      const id = String(args.id ?? "").trim();
      if (!id) return JSON.stringify({ error: "id is required" });

      const data = await getProduct({ id }, { signal: options.signal });
      return wrapMcpResult(
        compactCatalogMcpText(data),
        "Full details for this product (compacted). Use ONLY these facts (price, options/availability, link). A product is in stock when inStock is true or any option has available:true. For exact unit quantities, call get_inventory. Never invent details.",
      );
    }

    if (name === "get_inventory") {
      const singleId = String(args.id ?? "").trim();
      const ids = Array.isArray(args.ids)
        ? args.ids.map((x) => String(x).trim()).filter(Boolean)
        : [];

      if (!singleId && ids.length === 0) {
        return JSON.stringify({ error: "id or ids is required" });
      }

      if (ids.length > 0) {
        const batch = await fetchInventoryByIds(
          singleId ? [singleId, ...ids] : ids,
          { region: options.region, signal: options.signal },
        );
        return JSON.stringify({
          results: batch,
          hint: "Report exact quantities ONLY from this Admin inventory payload. If tracksInventory is false, do not invent a unit count — say quantity is not tracked. Zero means out of stock. Never estimate.",
        });
      }

      const result = await fetchProductInventory(singleId, {
        region: options.region,
        signal: options.signal,
      });

      if (!result) {
        return JSON.stringify({
          found: false,
          message:
            "Invalid product/variant id. Ask which product they mean, or resolve an id from CONVERSATION CONTEXT / a prior catalog tool result.",
        });
      }

      return JSON.stringify({
        ...result,
        hint: "Report exact quantities ONLY from this Admin inventory payload. If tracksInventory is false, do not invent a unit count. If totalInventory is 0, say the product is out of stock. If > 0, state the unit count naturally. Never estimate.",
      });
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
