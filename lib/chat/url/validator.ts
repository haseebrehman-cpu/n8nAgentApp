/**
 * Validate that a URL string is a well-formed http(s) link on an official
 * RDX Sports domain.
 */

import { isOfficialRdxHost } from "@/lib/chat/url/domains";

export type UrlValidationResult =
  | { ok: true; url: URL; hostname: string }
  | {
      ok: false;
      reason: "invalid_url" | "unsupported_protocol" | "non_official_domain";
    };

/**
 * Parse and validate a candidate URL. Accepts values with or without a
 * scheme (bare `www.rdxsports.com/...` is treated as https).
 */
export function validateRdxUrl(raw: string): UrlValidationResult {
  const trimmed = raw.trim().replace(/[),.!?;:]+$/g, "");
  if (!trimmed) return { ok: false, reason: "invalid_url" };

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported_protocol" };
  }

  if (!url.hostname) {
    return { ok: false, reason: "invalid_url" };
  }

  if (!isOfficialRdxHost(url.hostname)) {
    return { ok: false, reason: "non_official_domain" };
  }

  return { ok: true, url, hostname: url.hostname.toLowerCase() };
}

/** True when every candidate validates as an official RDX URL. */
export function allOfficialRdxUrls(rawUrls: string[]): boolean {
  if (rawUrls.length === 0) return false;
  return rawUrls.every((u) => validateRdxUrl(u).ok);
}
