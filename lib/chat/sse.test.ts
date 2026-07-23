import { describe, expect, it } from "vitest";
import { chunkText, encodeSse } from "@/lib/chat/sse";

describe("sse helpers", () => {
  it("encodes events", () => {
    expect(encodeSse({ type: "delta", text: "hi" })).toBe(
      'data: {"type":"delta","text":"hi"}\n\n'
    );
  });

  it("encodes done events with attachments", () => {
    const encoded = encodeSse({
      type: "done",
      reply: "chart below",
      requestId: "r1",
      attachments: [
        {
          kind: "size_chart",
          productId: "gid://shopify/Product/1",
          productTitle: "AS2",
          url: "https://cdn.shopify.com/s/files/1/1/files/a.webp",
          altText: "chart",
          width: 10,
          height: 10,
        },
      ],
    });
    expect(encoded).toContain('"type":"done"');
    expect(encoded).toContain('"kind":"size_chart"');
    expect(encoded).toContain("chart below");
  });

  it("chunks text", () => {
    expect([...chunkText("abcdefghij", 4)]).toEqual(["abcd", "efgh", "ij"]);
  });
});
