import { NextRequest, NextResponse } from "next/server";
import { runChatAgent } from "@/lib/chat-agent";
import { isConfigError } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ChatMessagePayload } from "@/lib/types";

export const runtime = "nodejs";

const MAX_HISTORY_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4_000;

function sanitizeHistory(raw: unknown): ChatMessagePayload[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const messages: ChatMessagePayload[] = [];
  for (const item of raw.slice(-MAX_HISTORY_MESSAGES)) {
    if (typeof item !== "object" || item === null) return null;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return null;
    }
    messages.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) });
  }

  if (messages[messages.length - 1]?.role !== "user") return null;
  return messages;
}

function clientKey(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(clientKey(req));
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many messages. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  let history: ChatMessagePayload[] | null = null;
  try {
    const body = await req.json();
    history = sanitizeHistory(body?.messages);
  } catch {
    history = null;
  }
  if (!history) {
    return NextResponse.json(
      { error: "Request body must be { messages: [{ role, content }, ...] } ending with a user message." },
      { status: 400 }
    );
  }

  try {
    const reply = await runChatAgent(history);
    return NextResponse.json({ reply });
  } catch (err) {
    if (isConfigError(err)) {
      console.error("[api/chat] configuration error:", err.message);
      return NextResponse.json(
        { error: "The assistant is not fully configured yet. Please try again later." },
        { status: 503 }
      );
    }
    console.error("[api/chat] failed:", err);
    return NextResponse.json(
      { error: "The assistant is temporarily unavailable. Please try again shortly." },
      { status: 502 }
    );
  }
}
