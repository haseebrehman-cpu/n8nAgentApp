/**
 * Customer-facing replies for RDX URL handling errors.
 */

export const NON_OFFICIAL_RDX_URL_REPLY =
  "I can only provide information for official RDX Sports website links.";

export const INVALID_URL_REPLY =
  "That link doesn't look valid. Please share a full RDX Sports URL (for example a product or collection page) and I'll look it up.";

export const UNSUPPORTED_RDX_PAGE_REPLY =
  "I can help with product, collection, blog, page, and policy links from the official RDX Sports website. That page type isn't supported yet — share one of those links and I'll pull the details.";

export const RESOURCE_NOT_FOUND_REPLY =
  "I couldn't find that page on the RDX Sports store. Please check the link, or share the product/collection name and I'll search for it.";

export const MCP_FAILURE_REPLY =
  "I'm having trouble looking that up right now. Please try again in a moment, or share the product name and I'll search the catalog instead.";

export function buildUrlFallbackReply(
  resourceLabel: string,
  summary: string,
): string {
  const trimmed = summary.trim();
  if (!trimmed) {
    return `Here's what I found for that ${resourceLabel}. If you have a more specific question, ask away.`;
  }
  return trimmed;
}
