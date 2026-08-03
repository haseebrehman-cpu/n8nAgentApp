import { describe, expect, it, vi } from "vitest";
import { streamChatReply } from "@/lib/chat/client/streamChatReply";

function sseBody(events: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

describe("streamChatReply", () => {
  it("does not overwrite a server error with the rephrase fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "text/event-stream" },
        body: sseBody([
          {
            type: "error",
            error: "The assistant is temporarily unavailable. Please try again.",
          },
        ]),
      }),
    );

    const contents: string[] = [];
    await streamChatReply(
      { message: "hi", newSession: false, signal: new AbortController().signal },
      {
        onAssistantContent: (content) => {
          contents.push(content);
        },
      },
    );

    expect(contents.at(-1)).toBe(
      "The assistant is temporarily unavailable. Please try again.",
    );
    expect(contents.join(" ")).not.toMatch(/didn't catch that/i);

    vi.unstubAllGlobals();
  });
});
