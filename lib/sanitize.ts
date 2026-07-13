/**
 * Strip content the assistant must never surface in chat:
 * raw image markdown, Shopify CDN URLs, and excess blank lines.
 * Also normalizes unicode bullets so markdown renders them as lists.
 */
export function sanitizeReply(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/https?:\/\/cdn\.shopify\.com\S+/gi, "")
    .replace(/^[ \t]*[•●▪︎]/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
