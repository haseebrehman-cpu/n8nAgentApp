import { NextRequest, NextResponse } from "next/server";
import { runChatAgent } from "@/lib/chat-agent";
import { sanitizeChatAttachments } from "@/lib/chat/attachments";
import { markChatInactive } from "@/lib/chat/persist-mongo";
import {
  appendUserMessage,
  getOrCreateSession,
  getSessionCookieName,
  MAX_MESSAGE_CHARS,
  newRequestId,
  saveSession,
  sessionCookieOptions,
  shortSessionId,
} from "@/lib/chat/session";
import {
  chunkText,
  createSseResponse,
  encodeSse,
} from "@/lib/chat/sse";
import { isConfigError } from "@/lib/config";
import { getClientIp } from "@/lib/http/client-ip";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseShopifyRegion } from "@/services/shopify/credentials";

export const runtime = "nodejs";
/** Allow enough time for OpenAI + Shopify MCP (Vercel default is 10–15s). */
export const maxDuration = 60;

function wantsStream(req: NextRequest, body: unknown): boolean {
  if (req.nextUrl.searchParams.get("stream") === "1") return true;
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) return true;
  if (
    typeof body === "object" &&
    body !== null &&
    (body as { stream?: unknown }).stream === true
  ) {
    return true;
  }
  return false;
}

/**
 * Accept either `{ message }` (preferred) or legacy `{ messages }` (user turns only).
 */
function extractUserMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const obj = body as { message?: unknown; messages?: unknown };

  if (typeof obj.message === "string") {
    const trimmed = obj.message.trim();
    if (!trimmed || trimmed.length > MAX_MESSAGE_CHARS) return null;
    return trimmed.slice(0, MAX_MESSAGE_CHARS);
  }

  if (Array.isArray(obj.messages) && obj.messages.length > 0) {
    for (let i = obj.messages.length - 1; i >= 0; i--) {
      const item = obj.messages[i];
      if (
        typeof item === "object" &&
        item !== null &&
        (item as { role?: unknown }).role === "user" &&
        typeof (item as { content?: unknown }).content === "string"
      ) {
        const content = ((item as { content: string }).content ?? "").trim();
        if (!content) return null;
        return content.slice(0, MAX_MESSAGE_CHARS);
      }
    }
  }

  return null;
}

function withSessionCookie(
  res: NextResponse,
  sessionId: string
): NextResponse {
  res.cookies.set(getSessionCookieName(), sessionId, sessionCookieOptions());
  return res;
}

export async function POST(req: NextRequest) {
  const requestId = newRequestId();

  const rate = await checkRateLimit(getClientIp(req), { bucket: "chat" });
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: rate.failClosed
          ? "The assistant is temporarily unavailable. Please try again shortly."
          : "Too many messages. Please wait a moment and try again.",
      },
      {
        status: rate.failClosed ? 503 : 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const userMessage = extractUserMessage(body);
  if (!userMessage) {
    return NextResponse.json(
      {
        error:
          'Request body must be { "message": "..." } (or legacy { "messages": [...] } ending with a user message).',
      },
      { status: 400 }
    );
  }

  const region = parseShopifyRegion(
    typeof body === "object" && body !== null
      ? (body as { region?: unknown }).region
      : undefined
  );
  const forceNew =
    typeof body === "object" &&
    body !== null &&
    (body as { newSession?: unknown }).newSession === true;
  const stream = wantsStream(req, body);

  const cookieName = getSessionCookieName();
  const { session, isNew, previousSessionId } = await getOrCreateSession(
    req.cookies.get(cookieName)?.value,
    { forceNew },
  );

  if (previousSessionId) {
    void markChatInactive(previousSessionId);
  }

  appendUserMessage(session, userMessage);

  logger.info("api/chat", "request", {
    requestId,
    session: shortSessionId(session.id),
    isNew,
    forceNew,
    state: session.state,
    stream,
  });

  if (stream) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const result = await runChatAgent(session.messages, {
            session,
            signal: req.signal,
            region,
            requestId,
          });
          await saveSession(session);
          const attachments = sanitizeChatAttachments(result.attachments);

          for (const part of chunkText(result.reply)) {
            if (req.signal.aborted) break;
            controller.enqueue(encoder.encode(encodeSse({ type: "delta", text: part })));
          }
          controller.enqueue(
            encoder.encode(
              encodeSse({
                type: "done",
                reply: result.reply,
                requestId,
                ...(attachments.length ? { attachments } : {}),
              }),
            ),
          );
        } catch (err) {
          await saveSession(session);
          const message = isConfigError(err)
            ? "The assistant is not fully configured yet. Please try again later."
            : err instanceof Error &&
                (err.name === "AbortError" || /aborted/i.test(err.message))
              ? "Request cancelled."
              : "The assistant is temporarily unavailable. Please try again shortly.";
          logger.error("api/chat", "stream failed", {
            requestId,
            error: err instanceof Error ? err.message : String(err),
          });
          controller.enqueue(
            encoder.encode(encodeSse({ type: "error", error: message }))
          );
        } finally {
          controller.close();
        }
      },
    });

    const res = createSseResponse(readable);
    // Attach session cookie via NextResponse wrapper
    const nextRes = new NextResponse(res.body, {
      status: 200,
      headers: res.headers,
    });
    nextRes.cookies.set(cookieName, session.id, sessionCookieOptions());
    return nextRes;
  }

  try {
    const result = await runChatAgent(session.messages, {
      session,
      signal: req.signal,
      region,
      requestId,
    });

    await saveSession(session);
    const attachments = sanitizeChatAttachments(result.attachments);

    return withSessionCookie(
      NextResponse.json({
        reply: result.reply,
        requestId,
        ...(attachments.length ? { attachments } : {}),
      }),
      session.id
    );
  } catch (err) {
    await saveSession(session);

    if (isConfigError(err)) {
      logger.error("api/chat", "configuration error", {
        requestId,
        error: err.message,
      });
      return NextResponse.json(
        { error: "The assistant is not fully configured yet. Please try again later." },
        { status: 503 }
      );
    }

    if (
      err instanceof Error &&
      (err.name === "AbortError" || /aborted/i.test(err.message))
    ) {
      return NextResponse.json({ error: "Request cancelled." }, { status: 400 });
    }

    logger.error("api/chat", "failed", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "The assistant is temporarily unavailable. Please try again shortly." },
      { status: 502 }
    );
  }
}
