import { describe, expect, it } from "vitest";
import { validateRdxUrl } from "@/lib/chat/url/validator";

describe("validateRdxUrl", () => {
  it("accepts official RDX domains including www", () => {
    for (const host of [
      "rdxsports.co.uk",
      "www.rdxsports.com",
      "rdxsports.fr",
      "rdxsports.de",
      "rdxsports.es",
      "rdxsports.eu",
    ]) {
      const result = validateRdxUrl(`https://${host}/products/f6-gloves`);
      expect(result.ok).toBe(true);
    }
  });

  it("accepts scheme-less official URLs", () => {
    const result = validateRdxUrl("www.rdxsports.co.uk/collections/gloves");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url.pathname).toBe("/collections/gloves");
    }
  });

  it("rejects non-official domains", () => {
    const result = validateRdxUrl("https://amazon.com/rdx-gloves");
    expect(result).toEqual({ ok: false, reason: "non_official_domain" });
  });

  it("rejects invalid URLs", () => {
    expect(validateRdxUrl("https://")).toEqual({
      ok: false,
      reason: "invalid_url",
    });
  });
});
