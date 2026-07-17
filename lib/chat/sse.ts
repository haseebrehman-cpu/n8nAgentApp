/**
 * Server-Sent Events helpers for additive chat streaming.
 * Tools remain server-side; clients receive final assistant text as deltas.
 */

export type ChatSseEvent =
  | { type: "delta"; text: string }
  | { type: "done"; reply: string; requestId: string }
  | { type: "error"; error: string };

export function encodeSse(event: ChatSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Split a completed reply into progressive chunks for SSE clients. */
export function* chunkText(text: string, size = 48): Generator<string> {
  if (!text) return;
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
  }
}

export function createSseResponse(
  stream: ReadableStream<Uint8Array>,
  init?: ResponseInit
): Response {
  return new Response(stream, {
    ...init,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...init?.headers,
    },
  });
}
