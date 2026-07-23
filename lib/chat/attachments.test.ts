import { afterEach, describe, expect, it } from "vitest";
import { sanitizeChatAttachments } from "@/lib/chat/attachments";

describe("sanitizeChatAttachments", () => {
  const prevHost = process.env.NEXT_PUBLIC_STOREFRONT_HOST;

  afterEach(() => {
    if (prevHost === undefined) {
      delete process.env.NEXT_PUBLIC_STOREFRONT_HOST;
    } else {
      process.env.NEXT_PUBLIC_STOREFRONT_HOST = prevHost;
    }
  });

  it("keeps allowlisted size charts and drops invalid ones", () => {
    process.env.NEXT_PUBLIC_STOREFRONT_HOST = "rdxsports.co.uk";
    const out = sanitizeChatAttachments([
      {
        kind: "size_chart",
        productId: "gid://shopify/Product/1",
        productTitle: "AS2 Gloves",
        url: "https://rdxsports.co.uk/cdn/shop/files/BGR-AS2_Size_Chart_new.webp?v=1",
        altText: "AS2 size chart",
        width: 800,
        height: 600,
      },
      {
        kind: "size_chart",
        productId: "gid://shopify/Product/2",
        productTitle: "Evil",
        url: "https://evil.example/cdn/shop/files/chart.webp",
        altText: "nope",
        width: null,
        height: null,
      },
      { kind: "other", url: "https://rdxsports.co.uk/cdn/shop/files/x.webp" },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]?.productTitle).toBe("AS2 Gloves");
    expect(out[0]?.url).toContain("BGR-AS2");
  });

  it("returns empty for non-arrays", () => {
    expect(sanitizeChatAttachments(null)).toEqual([]);
    expect(sanitizeChatAttachments({})).toEqual([]);
  });
});
