/**
 * Browser-side transport for the chat endpoint. POSTs a user message to
 * /api/chat and streams the assistant reply via Server-Sent Events, falling
 * back to a plain JSON reply when streaming is unavailable. Framework-agnostic:
 * it reports assistant content through a callback and knows nothing about React.
 *
 * Aborts propagate to the caller (AbortError); network/stream errors are
 * surfaced as a user-facing message through `onAssistantContent`.
 */

import { sanitizeChatAttachments } from "@/lib/chat/attachments";
import { stripAssistantMedia } from "@/lib/sanitize";
import type { ChatAttachment } from "@/lib/types";

const GENERIC_ERROR =
  "Something went wrong on our side. Please try again in a moment.";
const NO_REPLY_FALLBACK =
  "I didn't catch that. Could you rephrase your question?";
const STREAM_ERROR = "Something went wrong. Please try again.";

interface SseEvent {
  type: string;
  text?: string;
  reply?: string;
  error?: string;
  attachments?: unknown;
}

export interface StreamChatParams {
  message: string;
  newSession: boolean;
  signal: AbortSignal;
}

export interface StreamChatHandlers {
  /** Called with the latest full assistant content to show (create or update). */
  onAssistantContent: (
    content: string,
    meta?: { attachments?: ChatAttachment[] },
  ) => void;
}

export async function streamChatReply(
  { message, newSession, signal }: StreamChatParams,
  { onAssistantContent }: StreamChatHandlers,
): Promise<void> {
  const res = await fetch("/api/chat?stream=1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    credentials: "same-origin",
    signal,
    body: JSON.stringify({ message, stream: true, newSession }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    onAssistantContent(data?.error ?? GENERIC_ERROR);
    return;
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !res.body) {
    const data = (await res.json().catch(() => null)) as {
      reply?: string;
      error?: string;
      attachments?: unknown;
    } | null;
    const attachments = sanitizeChatAttachments(data?.attachments);
    onAssistantContent(
      stripAssistantMedia(data?.reply || data?.error || NO_REPLY_FALLBACK),
      attachments.length ? { attachments } : undefined,
    );
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assembled = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const event = JSON.parse(line.slice(6)) as SseEvent;
        if (event.type === "delta" && event.text) {
          assembled += event.text;
          onAssistantContent(stripAssistantMedia(assembled));
        } else if (event.type === "done" && event.reply) {
          assembled = event.reply;
          const attachments = sanitizeChatAttachments(event.attachments);
          onAssistantContent(
            stripAssistantMedia(assembled),
            attachments.length ? { attachments } : undefined,
          );
        } else if (event.type === "error") {
          onAssistantContent(event.error ?? STREAM_ERROR);
        }
      } catch {
        // ignore malformed SSE chunks
      }
    }
  }

  if (!assembled.trim()) {
    onAssistantContent(NO_REPLY_FALLBACK);
  }
}
