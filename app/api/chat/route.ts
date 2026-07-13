import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { NextRequest, NextResponse } from "next/server";
import { searchProducts, isShopifyConfigError } from "@/lib/shopify";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";

function sanitizeReply(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/https?:\/\/cdn\.shopify\.com\S+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const runtime = "nodejs";

const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY_MESSAGES = 30;

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
    if (isShopifyConfigError(err)) {
      return JSON.stringify({
        error:
          "The product catalog is not connected yet. Apologize to the customer and say product information is temporarily unavailable.",
      });
    }
    console.error(`Tool ${name} failed:`, err);
    return JSON.stringify({
      error: "The product lookup failed. Apologize and ask the customer to try again shortly.",
    });
  }
}

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

function sanitizeHistory(raw: unknown): IncomingMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const messages: IncomingMessage[] = [];
  for (const item of raw.slice(-MAX_HISTORY_MESSAGES)) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("role" in item) ||
      !("content" in item)
    ) {
      return null;
    }
    const { role, content } = item as { role: unknown; content: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return null;
    }
    messages.push({ role, content: content.slice(0, 4000) });
  }
  return messages;
}

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured. Add it to .env.local." },
      { status: 500 }
    );
  }

  let history: IncomingMessage[] | null = null;
  try {
    const body = await req.json();
    history = sanitizeHistory(body?.messages);
  } catch {
    history = null;
  }
  if (!history) {
    return NextResponse.json(
      { error: "Request body must be { messages: [{ role, content }, ...] }." },
      { status: 400 }
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const conversation: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  try {
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
        return NextResponse.json({
          reply: sanitizeReply(message.content ?? ""),
        });
      }

      conversation.push(message);
      for (const toolCall of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          // fall through with empty args; the tool reports the problem back to the model
        }
        const result = await runTool(toolCall.function.name, args);
        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }

    return NextResponse.json({
      reply:
        "I'm sorry, I couldn't complete that request. Could you rephrase it or try again?",
    });
  } catch (err) {
    console.error("Chat completion failed:", err);
    return NextResponse.json(
      { error: "The assistant is temporarily unavailable. Please try again shortly." },
      { status: 502 }
    );
  }
}
