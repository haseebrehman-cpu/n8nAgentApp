/**
 * Executes a single agent tool call against Shopify MCP / order tracking and
 * returns a model-ready string result. Owns per-tool argument handling and
 * error mapping; it does not decide when tools are called (the orchestrator
 * does) — its single responsibility is running one tool safely.
 *
 * Product catalog discovery is delegated to `executeSemanticSearch` (Clean
 * Architecture application layer). Exact unit quantities use Admin GraphQL
 * via get_inventory.
 */

import { isConfigError } from "@/lib/config";
import { logger } from "@/lib/logger";
import { compactCatalogMcpText } from "@/lib/shopify/compact-catalog";
import {
  getProduct,
  lookupCatalog,
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
import type { CatalogResponseMode } from "@/lib/chat/intent";
import {
  CATEGORY_PAYLOAD_PRODUCTS,
  LIST_PAYLOAD_PRODUCTS,
} from "@/lib/chat/agent/config";
import { wrapMcpResult } from "@/lib/chat/agent/mcp-format";
import { executeSemanticSearch } from "@/lib/chat/search";
import type { ShownProduct } from "@/lib/chat/context/product-memory";
import {
  parseCatalogGid,
  toShopifyProductGid,
} from "@/lib/shopify/gid";

export interface RunToolOptions {
  region?: ShopifyStoreRegion;
  signal?: AbortSignal;
  lastUser?: string;
  /** Prior catalog search query from session — enables follow-up merge. */
  lastSearchQuery?: string | null;
  /** Products most recently shown — enables context-filter reuse. */
  lastShownProducts?: ShownProduct[] | null;
  /**
   * Called after a successful search_catalog so the session can remember the
   * effective query for the next turn's refinements.
   */
  onSearchQuery?: (query: string) => void;
  /**
   * Called when get_size_chart resolves a verified chart. The model never sees
   * the raw image URL — only this callback receives it for the HTTP response.
   */
  onSizeChartAttachment?: (attachment: ChatAttachment) => void;
}

function hintForMode(
  mode: CatalogResponseMode,
  collectionLabel?: string,
  confidence?: string,
): string {
  const confidenceNote =
    confidence === "low" || confidence === "empty"
      ? " Search confidence is low — if results look weak, ask a clarifying question rather than inventing products."
      : confidence === "partial"
        ? " Results are a partial match — prefer the highest relevanceScore items and offer to narrow further."
        : "";

  if (mode === "list") {
    const scope = collectionLabel
      ? ` from the live storefront collection ${collectionLabel}`
      : "";
    return `LIST MODE${scope}: Use the Full list response template (headings, bullets, Product Cards — no tables, no JSON, no field names). productCount is the category total (exact when countIsExactCategoryTotal is true; otherwise say "at least" that many). Show at most ${LIST_PAYLOAD_PRODUCTS} products. If truncated, say you are showing the first ${LIST_PAYLOAD_PRODUCTS} only. Never invent products or stock.${confidenceNote}`;
  }

  if (mode === "category") {
    const scope = collectionLabel
      ? ` from the live storefront collection ${collectionLabel}`
      : "";
    return `CATEGORY MODE${scope}: Use the Category listing response template (headings, bullets, Product Cards — no tables, no JSON, no field names). State the total from productCount (exact when countIsExactCategoryTotal is true). Show up to ${CATEGORY_PAYLOAD_PRODUCTS} products, then invite narrowing by model, size, weight, material, or use. Never invent products or stock.${confidenceNote}`;
  }

  if (mode === "specific") {
    return `SPECIFIC PRODUCT MODE: Prefer the best title match. If the customer asked about one product, call get_product with its id and use the Product details template — that product only. No tables, no JSON, no internal field names. Never invent products or stock.${confidenceNote}`;
  }

  return `Live semantic search results (compacted, deduped, relevance-ranked). Use the Product search or Recommendations response template: headings, short paragraphs (max 2 sentences), hyphen bullets, Product Cards. Prefer higher relevanceScore but NEVER expose field names (relevanceScore, productCount, etc.) to the customer. Recommend the best 3 (max 5), then one next step. No markdown tables, no JSON. Never invent products or stock.${confidenceNote}`;
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  options: RunToolOptions,
): Promise<string> {
  try {
    if (name === "search_catalog") {
      const wantInStockOnly = /\b(in\s+stock|available\s+only)\b/i.test(
        options.lastUser ?? "",
      );
      const availableOnly =
        wantInStockOnly ||
        args.availableOnly === true ||
        args.availableOnly === "true";

      const result = await executeSemanticSearch({
        query: String(args.query ?? ""),
        lastUser: options.lastUser ?? "",
        lastSearchQuery: options.lastSearchQuery,
        lastShownProducts: options.lastShownProducts,
        availableOnly,
        forCount:
          args.forCount === true || args.forCount === "true",
        limit: Number(args.limit),
        signal: options.signal,
        budgetMax:
          typeof args.budgetMax === "number" ? args.budgetMax : undefined,
        onSaleOnly:
          args.onSaleOnly === true || args.onSaleOnly === "true",
      });

      if (result.effectiveQuery) {
        options.onSearchQuery?.(result.effectiveQuery);
      }

      const hintMode =
        result.mode === "generic" && result.collectionLabel
          ? "category"
          : result.mode;

      return wrapMcpResult(
        result.compactJson,
        hintForMode(
          hintMode,
          result.collectionLabel,
          result.confidence,
        ),
      );
    }

    if (name === "get_product") {
      const rawId = String(args.id ?? "").trim();
      if (!rawId) return JSON.stringify({ error: "id is required" });
      const id = toShopifyProductGid(rawId);
      if (!id) {
        return JSON.stringify({
          error: "invalid_product_id",
          message:
            "That product id is invalid. Do NOT invent ids. Call search_catalog first, then use an id from the results.",
        });
      }

      try {
        const data = await getProduct({ id }, { signal: options.signal });
        return wrapMcpResult(
          compactCatalogMcpText(data),
          "Full details for this product (compacted). Use ONLY these facts (price, options/availability, link). A product is in stock when inStock is true or any option has available:true. For exact unit quantities, call get_inventory. Never invent details. If inStock is null, do not claim stock — call get_product variants or get_inventory.",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/product_not_found/i.test(msg)) {
          return JSON.stringify({
            error: "product_not_found",
            id,
            message:
              "That product id was not found. Do NOT invent or reuse guessed ids. Call search_catalog with the product name (e.g. 'F4 gloves', 'F6 gloves'), then call get_product or lookup_catalog using an id from those search results.",
          });
        }
        throw err;
      }
    }

    if (name === "get_inventory") {
      const singleRaw = String(args.id ?? "").trim();
      const rawIds = Array.isArray(args.ids)
        ? args.ids.map((x) => String(x).trim()).filter(Boolean)
        : [];

      const singleParsed = singleRaw ? parseCatalogGid(singleRaw) : null;
      const singleId = singleParsed?.gid ?? "";
      const ids = rawIds
        .map((x) => parseCatalogGid(x)?.gid)
        .filter((x): x is string => Boolean(x));

      if (!singleId && ids.length === 0) {
        return JSON.stringify({
          error: "invalid_product_id",
          message:
            "id or ids is required and must be a real product/variant id from CONVERSATION CONTEXT or a prior tool result. Call search_catalog first if you do not have one.",
        });
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

      const total =
        result && typeof result.totalInventory === "number"
          ? result.totalInventory
          : null;
      const lowStock =
        result?.tracksInventory === true &&
        total != null &&
        total > 0 &&
        total <= 5;

      return JSON.stringify({
        ...result,
        lowStock: lowStock || undefined,
        hint: lowStock
          ? `LOW STOCK: Only ${total} units left. Tell the customer clearly (e.g. "only ${total} left") and offer to help them choose a size/colour while stock lasts. Report exact quantities ONLY from this payload. Never estimate.`
          : "Report exact quantities ONLY from this Admin inventory payload. If tracksInventory is false, do not invent a unit count. If totalInventory is 0, say the product is out of stock. If > 0, state the unit count naturally. When totalInventory is 1–5, mention low stock. Never estimate.",
      });
    }

    if (name === "get_size_chart") {
      const rawId = String(args.id ?? "").trim();
      if (!rawId) return JSON.stringify({ error: "id is required" });
      const id = toShopifyProductGid(rawId);
      if (!id) {
        return JSON.stringify({
          error: "invalid_product_id",
          message:
            "That product id is invalid. Call search_catalog first, then get_size_chart with a real id.",
        });
      }

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
        ? args.ids
            .map((x) => parseCatalogGid(String(x).trim())?.gid)
            .filter((x): x is string => Boolean(x))
        : [];
      if (ids.length === 0) {
        return JSON.stringify({
          error: "invalid_product_id",
          message:
            "ids is required and must be real product/variant ids from prior results. Call search_catalog first.",
        });
      }

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
    const catalogTool =
      name === "search_catalog" ||
      name === "get_product" ||
      name === "lookup_catalog" ||
      name === "get_inventory" ||
      name === "get_size_chart";

    if (isConfigError(err)) {
      logger.error("chat-agent", `tool "${name}" config error`, {
        error: err.message,
      });
      return JSON.stringify(
        catalogTool
          ? {
              error: "search_failed",
              productCount: 0,
              products: [],
              message:
                "The store connection is not ready yet. Apologize and say the service is temporarily unavailable.",
            }
          : {
              error:
                "The store connection is not ready yet. Apologize and say the service is temporarily unavailable.",
            },
      );
    }
    logger.error("chat-agent", `tool "${name}" failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    // Structured infra code so the agent can short-circuit to a canned reply
    // instead of letting the model paraphrase internal failures.
    return JSON.stringify(
      catalogTool
        ? {
            error: "search_failed",
            productCount: 0,
            products: [],
            message:
              "The lookup failed. Apologize and ask the customer to try again shortly.",
          }
        : {
            error:
              "The lookup failed. Apologize and ask the customer to try again shortly.",
          },
    );
  }
}
