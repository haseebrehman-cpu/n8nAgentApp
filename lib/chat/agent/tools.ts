/**
 * OpenAI function-tool schemas the agent exposes to the model. Kept separate
 * from the orchestration loop so tool contracts can evolve independently.
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_catalog",
      description:
        "Search the store's product catalog via Shopify Storefront MCP for items matching the customer's needs — by product name, type, category, feature, colour, size, price, or whether they're on sale. Use for all product questions: search, categories, prices, variants, stock, counts, and recommendations. Prefer concise queries (e.g. 'boxing gloves', 'sauna vest', 'head guards', 'products on sale'). Synonyms: 'headgear' / 'boxing headgear' → search 'head guards'. For very broad asks like 'I need gloves' / 'I need protection' / 'I need gym equipment', ask a short clarifying question first instead of searching. Do NOT use this for policy, shipping, or order-tracking questions.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'Free-text search query, e.g. "boxing gloves", "kids punch bag", "products on sale".',
          },
          limit: {
            type: "number",
            description:
              "Optional max number of products to return (caps at 50). For any 'how many' / total count question, pass 50 (the server also auto-paginates counts for every category).",
          },
          availableOnly: {
            type: "boolean",
            description:
              "When true, only return products available for sale / in stock. Default is false — include out-of-stock items so counts and lists match full inventory. Set true only when the customer explicitly asks for in-stock / available-only items.",
          },
          forCount: {
            type: "boolean",
            description:
              "Set true for any explicit count question ('how many X', 'total X products') across every category. Triggers a higher limit and pagination so productCount is not capped at the default page size. Counts include out-of-stock unless availableOnly is true.",
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
        "Get full details for ONE specific product the customer has chosen, using a product id from a prior search_catalog or lookup_catalog result. Use when they want more detail, variants, sizes/colours, availability, or a link for a specific product. For an explicit size-chart / size-guide image request, prefer get_size_chart instead.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Product id (e.g. gid://shopify/Product/123) taken from a prior tool result.",
          },
        },
        required: ["id"],
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
