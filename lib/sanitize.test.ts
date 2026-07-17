import { describe, expect, it } from "vitest";
import { stripAssistantMedia } from "@/lib/sanitize";

describe("stripAssistantMedia", () => {
  it("removes image markdown and CDN urls", () => {
    const input =
      "Hello ![x](https://cdn.shopify.com/a.png) see https://cdn.shopify.com/foo.jpg";
    expect(stripAssistantMedia(input)).toBe("Hello  see");
  });

  it("normalizes bullets and redacts secrets", () => {
    const out = stripAssistantMedia("• item\nsk-abcdefghijklmnopqrstuvwxyz");
    expect(out.startsWith("-")).toBe(true);
    expect(out).toContain("item");
    expect(stripAssistantMedia("key sk-abcdefghijklmnopqrstuvwxyz")).toContain(
      "[redacted]"
    );
  });
});
