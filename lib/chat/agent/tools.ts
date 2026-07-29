/**
 * OpenAI function-tool schemas the agent exposes to the model. Kept separate
 * from the orchestration loop so tool contracts can evolve independently.
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import {
  CATEGORY_PAYLOAD_PRODUCTS,
  LIST_PAYLOAD_PRODUCTS,
  ORDER_TRACKING_ENABLED,
} from "@/lib/chat/agent/config";

const ALL_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_catalog",
      description:
        `Semantic product search (Shopify Storefront MCP). Use for product/category/collection discovery, recommendations, comparisons setup, alternatives, accessories/FBT add-ons, best sellers, new arrivals, trending, gifts, on-sale items, beginner/pro asks, and budget filters. Preserve full intent (use-case, colour, oz, material, budget, model codes). Synonyms: headgear → head guards. Merge short refinements with Last catalog search query. Caps: category/how-many → ${CATEGORY_PAYLOAD_PRODUCTS}; list-all → ${LIST_PAYLOAD_PRODUCTS}. Set forCount=true for "how many". Use get_inventory for exact units. Not for context-only compare/rank, policies, or order tracking.`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'Semantic query, e.g. "boxing sparring gloves", "best sellers", "new arrivals", "products on sale", "beginner boxing gloves", "gifts", "something similar to t15", "leather boxing gloves under £60". Merge refinements with prior search from context.',
          },
          limit: {
            type: "number",
            description:
              "Optional max number of products to return (caps at 50). Category/list modes apply server-side payload caps regardless of this value.",
          },
          availableOnly: {
            type: "boolean",
            description:
              "When true, only return products available for sale / in stock. Default is true for ordinary browse and product searches; use false only when the customer explicitly asks to include out-of-stock items or see the full inventory/all products.",
          },
          forCount: {
            type: "boolean",
            description:
              "Set true for ANY explicit count question ('how many X', 'total X products', 'number of X') across every category. ALWAYS set this when the customer says 'how many'. Triggers pagination so productCount is not capped at the default page size. Counts include out-of-stock unless availableOnly is true.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product",
      description:
        "Get full details for ONE specific product using its product id from a prior search_catalog, lookup_catalog, or CONVERSATION CONTEXT result. NEVER invent or guess ids — if you do not have a real id yet, call search_catalog first (especially for named comparisons like F4 vs F6). ALWAYS call get_product when the customer asks about available sizes, colours, weights, variants, options, or detailed specifications for a specific product. Do NOT guess or rely on search_catalog's sample variant. For exact unit quantities, prefer get_inventory. For an explicit size-chart / size-guide image request, prefer get_size_chart instead.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Product id (e.g. gid://shopify/Product/123) taken from a prior tool result — never invent this value.",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_inventory",
      description:
        "Get exact Admin inventory quantities for ONE product (all variants) or up to 10 known product/variant ids from prior tool results or CONVERSATION CONTEXT. Use when the customer asks how many units are left, exact stock count, or quantity for a specific size/colour. Not for category counts ('how many boxing gloves') — use search_catalog for those. Resolve pronouns (it/this/that) from CONVERSATION CONTEXT before calling.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Product or variant id (e.g. gid://shopify/Product/123 or gid://shopify/ProductVariant/456) from a prior tool result or conversation context.",
          },
          ids: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional batch of up to 10 product or variant ids from prior tool results.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_size_chart",
      description:
        "Fetch the official size-chart image for ONE specific product using its product id from a prior search_catalog, lookup_catalog, or get_product result (or CONVERSATION CONTEXT). Use when the customer asks for a size chart, size guide, sizing chart, or how to size that product. If several products were shown and they did not name one, ask which product first — do not guess. Never invent or paste image URLs; when found is true the chart image is shown to the customer automatically below your reply.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Product id (e.g. gid://shopify/Product/123) taken from a prior tool result or conversation context.",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_catalog",
      description:
        "Look up one or more products or variants by their known ids (e.g. gid://shopify/Product/123 or gid://shopify/ProductVariant/456) from prior tool results. Use to re-check specific items you already have ids for. Do NOT use for free-text search — use search_catalog instead.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description:
              "Up to 10 product or variant ids taken from prior tool results.",
          },
        },
        required: ["ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_shop_policies_and_faqs",
      description:
        "Answer questions about the store's policies and FAQs — shipping, delivery, returns, refunds, exchanges, warranty, payment, order changes, store hours, and how the store works. Use for any non-product informational question. Do NOT use for product catalog searches or order tracking.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The customer's policy or FAQ question.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "track_order",
      description:
        "Look up shipping status. Requires orderNumber AND the checkout email.",
      parameters: {
        type: "object",
        properties: {
          orderNumber: {
            type: "string",
            description:
              "Order number or name (e.g. 1001, #1001, OT-cbn4m39wmd).",
          },
          email: {
            type: "string",
            description: "Email used when placing the order.",
          },
        },
        required: ["orderNumber", "email"],
      },
    },
  },
];

/** Tools exposed to the model — track_order omitted while order tracking is off. */
export const tools: ChatCompletionTool[] = ORDER_TRACKING_ENABLED
  ? ALL_TOOLS
  : ALL_TOOLS.filter(
      (t) => t.type !== "function" || t.function.name !== "track_order",
    );
