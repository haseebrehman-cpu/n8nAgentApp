import { describe, expect, it } from "vitest";
import { detectRdxResourceType } from "@/lib/chat/url/resource-type";

function url(path: string): URL {
  return new URL(`https://rdxsports.co.uk${path}`);
}

describe("detectRdxResourceType", () => {
  it("detects product handles", () => {
    const result = detectRdxResourceType(url("/products/rdx-f6-sparring-gloves"));
    expect(result).toMatchObject({
      ok: true,
      resource: { type: "product", handle: "rdx-f6-sparring-gloves" },
    });
  });

  it("detects collections, pages, and policies", () => {
    expect(detectRdxResourceType(url("/collections/boxing-gloves"))).toMatchObject({
      ok: true,
      resource: { type: "collection", handle: "boxing-gloves" },
    });
    expect(detectRdxResourceType(url("/pages/about-us"))).toMatchObject({
      ok: true,
      resource: { type: "page", handle: "about-us" },
    });
    expect(detectRdxResourceType(url("/policies/privacy-policy"))).toMatchObject({
      ok: true,
      resource: { type: "policy", handle: "privacy-policy" },
    });
  });

  it("detects blog articles", () => {
    const nested = detectRdxResourceType(
      url("/blogs/news/articles/how-to-choose-gloves"),
    );
    expect(nested).toMatchObject({
      ok: true,
      resource: {
        type: "blog",
        handle: "how-to-choose-gloves",
        blogHandle: "news",
      },
    });

    const short = detectRdxResourceType(
      url("/blogs/news/how-to-choose-gloves"),
    );
    expect(short).toMatchObject({
      ok: true,
      resource: {
        type: "blog",
        handle: "how-to-choose-gloves",
        blogHandle: "news",
      },
    });
  });

  it("rejects unsupported paths", () => {
    expect(detectRdxResourceType(url("/cart"))).toEqual({
      ok: false,
      reason: "unsupported_path",
    });
    expect(detectRdxResourceType(url("/account/login"))).toEqual({
      ok: false,
      reason: "unsupported_path",
    });
  });

  it("rejects missing handles", () => {
    expect(detectRdxResourceType(url("/products"))).toEqual({
      ok: false,
      reason: "missing_handle",
    });
  });
});
