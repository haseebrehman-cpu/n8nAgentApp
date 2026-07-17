import { describe, expect, it } from "vitest";
import { chunkText, encodeSse } from "@/lib/chat/sse";

describe("sse helpers", () => {
  it("encodes events", () => {
    expect(encodeSse({ type: "delta", text: "hi" })).toBe(
      'data: {"type":"delta","text":"hi"}\n\n'
    );
  });

  it("chunks text", () => {
    expect([...chunkText("abcdefghij", 4)]).toEqual(["abcd", "efgh", "ij"]);
  });
});
