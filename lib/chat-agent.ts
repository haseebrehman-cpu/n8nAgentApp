/**
 * Conversational agent: OpenAI tool-calling loop with Shopify product search.
 * Lives inside Next.js — n8n is reserved for automation workflows.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { getOpenAIConfig, isConfigError } from "@/lib/config";
import { searchProducts } from "@/lib/shopify";
import { sanitizeReply } from "@/lib/sanitize";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import type { ChatMessagePayload } from "@/lib/types";

const MAX_TOOL_ROUNDS = 6;
const OPENAI_TIMEOUT_MS = 45_000;

const FALLBACK_REPLY =
  "I'm sorry, I couldn't complete that request. Could you rephrase it or try again?";

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the store's product catalog by keyword. Matches product title, type, vendor, and tags. Use SHORT keywords (1-2 words). Retry with different keywords if no results.",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description:
              'Short search keyword, 1-2 words. E.g. "boxing gloves", "shin guard", "WAKO".',
          },
        },
        required: ["keyword"],
      },
    },
  },
];

async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === "search_products") {
      const keyword = String(args.keyword ?? "").trim();
      if (!keyword) return JSON.stringify({ error: "keyword is required" });

      const products = await searchProducts(keyword);
      if (products.length === 0) {
        return JSON.stringify({
          results: [],
          hint: "No products matched. Retry with a different, shorter keyword before giving up.",
        });
      }
      return JSON.stringify({ results: products });
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

  const conversation: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await client.chat.completions.create({
      model,
      messages: conversation,
      tools,
      temperature: 0.4,
    });

    const message = completion.choices[0]?.message;
    if (!message) break;

    const toolCalls = message.tool_calls?.filter((tc) => tc.type === "function");
    if (!toolCalls || toolCalls.length === 0) {
      return sanitizeReply(message.content ?? "") || FALLBACK_REPLY;
    }

    conversation.push(message);
    for (const toolCall of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        // empty args; the tool reports the problem back to the model
      }
      const result = await runTool(toolCall.function.name, args);
      conversation.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return FALLBACK_REPLY;
}
