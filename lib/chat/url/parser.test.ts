import { describe, expect, it } from "vitest";
import {
  extractUrlsFromMessage,
  messageContainsUrl,
  parseMessageUrls,
} from "@/lib/chat/url/parser";

describe("url parser", () => {
  it("extracts http URLs and bare RDX paths", () => {
    const urls = extractUrlsFromMessage(
      "Check https://rdxsports.com/products/f6 and also rdxsports.co.uk/collections/gloves please",
    );
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(messageContainsUrl("no links here")).toBe(false);
    expect(messageContainsUrl("see https://rdxsports.fr/pages/about")).toBe(
      true,
    );
  });

  it("flags non-official domains", () => {
    const parsed = parseMessageUrls(
      "What about https://example.com/products/x ?",
    );
    expect(parsed.hasNonOfficial).toBe(true);
    expect(parsed.rdxUrls).toHaveLength(0);
  });

  it("collects multiple official RDX URLs for compare", () => {
    const parsed = parseMessageUrls(
      "Compare https://www.rdxsports.co.uk/products/a and https://rdxsports.com/products/b",
    );
    expect(parsed.hasNonOfficial).toBe(false);
    expect(parsed.rdxUrls).toHaveLength(2);
  });
});
