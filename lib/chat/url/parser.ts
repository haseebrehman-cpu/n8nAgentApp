/**
 * Extract URL-like tokens from a customer message.
 */

import { OFFICIAL_RDX_HOSTS } from "@/lib/chat/url/domains";
import { validateRdxUrl } from "@/lib/chat/url/validator";

const HOST_ALT = OFFICIAL_RDX_HOSTS.map((h) =>
  h.replace(/\./g, "\\."),
).join("|");

/** Full http(s) URLs anywhere in the message. */
const GENERIC_HTTP_URL_RE = /https?:\/\/[^\s<>"'`()[\]]+/gi;

/** Official RDX links with or without a scheme (www. allowed). */
const RDX_URL_RE = new RegExp(
  `(?:https?:\\/\\/)?(?:www\\.)?(?:${HOST_ALT})\\/[^\\s<>"'\\\`()\\[\\]]*`,
  "gi",
);

const RDX_HOST_ONLY_RE = new RegExp(
  `^(?:https?:\\/\\/)?(?:www\\.)?(?:${HOST_ALT})(?:[/?#]|$)`,
  "i",
);

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.!?;:'"]+$/g, "");
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function looksLikeRdxUrl(value: string): boolean {
  return RDX_HOST_ONLY_RE.test(value) || new RegExp(HOST_ALT, "i").test(value);
}

/** True when the message contains any http(s) or bare RDX storefront URL. */
export function messageContainsUrl(text: string): boolean {
  return extractUrlsFromMessage(text).length > 0;
}

/**
 * Pull URL candidates from free text: generic http(s) links plus scheme-less
 * official RDX paths (`rdxsports.com/products/...`).
 */
export function extractUrlsFromMessage(text: string): string[] {
  const source = text ?? "";
  const found: string[] = [];

  for (const match of source.matchAll(GENERIC_HTTP_URL_RE)) {
    found.push(stripTrailingPunctuation(match[0]!));
  }
  for (const match of source.matchAll(RDX_URL_RE)) {
    found.push(stripTrailingPunctuation(match[0]!));
  }

  return dedupePreserveOrder(found.filter(Boolean));
}

export interface ParsedMessageUrls {
  /** All URL-like tokens found in the message. */
  rawUrls: string[];
  /** Official RDX URLs that parsed cleanly. */
  rdxUrls: URL[];
  /** True when at least one token is a non-RDX or invalid http(s) link. */
  hasNonOfficial: boolean;
  /** True when a token looked like a URL but could not be parsed. */
  hasInvalid: boolean;
}

/** Classify every URL token in the message for the RDX URL handler. */
export function parseMessageUrls(text: string): ParsedMessageUrls {
  const rawUrls = extractUrlsFromMessage(text);
  const rdxUrls: URL[] = [];
  let hasNonOfficial = false;
  let hasInvalid = false;

  for (const raw of rawUrls) {
    const looksHttp = /^https?:\/\//i.test(raw);
    const result = validateRdxUrl(raw);
    if (result.ok) {
      rdxUrls.push(result.url);
      continue;
    }

    if (result.reason === "non_official_domain") {
      hasNonOfficial = true;
      continue;
    }

    if (looksHttp || looksLikeRdxUrl(raw)) {
      hasInvalid = true;
    }
  }

  return { rawUrls, rdxUrls, hasNonOfficial, hasInvalid };
}
