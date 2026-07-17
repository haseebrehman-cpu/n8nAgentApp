/**
 * Strip media / CDN content the assistant must never surface in chat.
 * This is NOT a full XSS sanitizer — pair with rehype-sanitize on render.
 */

const SECRET_LEAK =
  /\b(sk-[a-zA-Z0-9]{10,}|OPENAI_API_KEY|SHOPIFY_ADMIN_ACCESS_TOKEN|REDIS_URL)\b/gi;

export function stripAssistantMedia(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/https?:\/\/cdn\.shopify\.com\S+/gi, "")
    .replace(SECRET_LEAK, "[redacted]")
    .replace(/^[ \t]*[•●▪︎]/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** @deprecated Use stripAssistantMedia — kept for import compatibility. */
export const sanitizeReply = stripAssistantMedia;
