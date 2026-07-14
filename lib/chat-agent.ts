/**
 * Conversational agent: OpenAI tool-calling loop with Shopify product search.
 * Lives inside Next.js — n8n is reserved for automation workflows.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import { getOpenAIConfig, isConfigError } from "@/lib/config";
import { getDiscountedProducts, searchProducts } from "@/lib/shopify";
import { sanitizeReply } from "@/lib/sanitize";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import type { ChatMessagePayload } from "@/lib/types";

const MAX_TOOL_ROUNDS = 6;
const OPENAI_TIMEOUT_MS = 45_000;

const FALLBACK_REPLY =
  "I'm sorry, I couldn't complete that request. Could you rephrase it or try again?";

const NOT_AVAILABLE_REPLY = "Product not available.";

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the store catalog. Use for any product name, model, price, size, colour, or stock question. Prefer 2–4 distinctive words from the product title.",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description:
              'Search keywords, ideally 2–4 words. E.g. "robo kids punch", "boxing gloves", "shin guard".',
          },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_discounted_products",
      description:
        "List products that are currently on sale/discount (price reduced from the original). Use ONLY for questions about discounts, sales, offers, deals, or reduced prices. Do not pass a product name.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

/** Detect messages that should look up the catalog (not greetings / unavailable services). */
function shouldForceProductSearch(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  if (
    /^(hi|hello|hey|good\s+(morning|afternoon|evening)|thanks|thank you|ok|okay|bye)\b/.test(
      t
    ) &&
    t.length < 40
  ) {
    return false;
  }

  if (
    /\b(track\s+(my\s+)?order|place\s+(an\s+)?order|refund|return|damaged)\b/.test(t) &&
    !/\b(product|price|size|stock|colour|color|available)\b/.test(t)
  ) {
    return false;
  }

  // Menu option labels / short prompts that are not a product lookup yet
  if (t === "product information") return false;

  return true;
}

/** Detect questions about sales/discounts so we route to the discount tool. */
function isDiscountQuery(text: string): boolean {
  return /\b(discount|discounts|discounted|sale|sales|on\s+sale|offer|offers|deal|deals|reduced|clearance|promo|promotion|promotions|bargain|markdown)\b/i.test(
    text
  );
}

async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === "search_products") {
      const keyword = String(args.keyword ?? "").trim();
      if (!keyword) return JSON.stringify({ error: "keyword is required" });

      const products = await searchProducts(keyword);
      if (products.length === 0) {
        return JSON.stringify({
          results: [],
          hint:
            "No products matched. Retry once with different shorter keywords. If still empty, reply exactly: Product not available.",
        });
      }
      return JSON.stringify({ results: products });
    }

    if (name === "list_discounted_products") {
      const products = await getDiscountedProducts();
      if (products.length === 0) {
        return JSON.stringify({
          results: [],
          hint:
            "No products are currently on sale. Tell the customer there are no active discounts right now — do not invent any.",
        });
      }
      return JSON.stringify({
        results: products,
        hint: `Found ${products.length} storefront product(s) on sale. List ALL of them briefly — do not omit any.`,
      });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err) {
    if (isConfigError(err)) {
      return JSON.stringify({
        error:
          "The product catalog is not connected yet. Apologize and say product information is temporarily unavailable.",
      });
    }
    console.error(`[chat-agent] tool "${name}" failed:`, err);
    return JSON.stringify({
      error: "The product lookup failed. Apologize and ask the customer to try again shortly.",
    });
  }
}

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!cachedClient) {
    const { apiKey } = getOpenAIConfig();
    cachedClient = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 2 });
  }
  return cachedClient;
}

/** Run the agent over sanitized history and return the assistant's reply. */
export async function runChatAgent(history: ChatMessagePayload[]): Promise<string> {
  const client = getClient();
  const { model } = getOpenAIConfig();

  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const wantsDiscounts = isDiscountQuery(lastUser);
  const forceSearch = !wantsDiscounts && shouldForceProductSearch(lastUser);

  const conversation: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  let sawEmptyCatalog = false;
  let usedDiscountTool = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let toolChoice: ChatCompletionToolChoiceOption = "auto";
    if (round === 0) {
      if (wantsDiscounts) {
        toolChoice = { type: "function", function: { name: "list_discounted_products" } };
      } else if (forceSearch) {
        toolChoice = { type: "function", function: { name: "search_products" } };
      }
    }

    const completion = await client.chat.completions.create({
      model,
      messages: conversation,
      tools,
      tool_choice: toolChoice,
      temperature: 0.3,
    });

    const message = completion.choices[0]?.message;
    if (!message) break;

    const toolCalls = message.tool_calls?.filter((tc) => tc.type === "function");
    if (!toolCalls || toolCalls.length === 0) {
      const reply = sanitizeReply(message.content ?? "") || FALLBACK_REPLY;
      // If we already searched and still got a vague greeting, prefer the clear not-available line
      if (
        sawEmptyCatalog &&
        /how can i assist|products and shopping/i.test(reply)
      ) {
        return NOT_AVAILABLE_REPLY;
      }
      return reply;
    }

    conversation.push(message);
    for (const toolCall of toolCalls) {
      if (toolCall.type !== "function") continue;

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        // empty args; the tool reports the problem back to the model
      }
      const isDiscountTool = toolCall.function.name === "list_discounted_products";
      if (isDiscountTool) usedDiscountTool = true;
      const result = await runTool(toolCall.function.name, args);
      try {
        const parsed = JSON.parse(result) as { results?: unknown[] };
        // Empty discount results are a valid answer ("no sales"), not a missing product.
        if (!isDiscountTool && Array.isArray(parsed.results) && parsed.results.length === 0) {
          sawEmptyCatalog = true;
        } else if (Array.isArray(parsed.results) && parsed.results.length > 0) {
          sawEmptyCatalog = false;
        }
      } catch {
        // ignore parse errors
      }
      conversation.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return sawEmptyCatalog && !usedDiscountTool ? NOT_AVAILABLE_REPLY : FALLBACK_REPLY;
}
