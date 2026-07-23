/**
 * Helpers for server-verified chat attachments (size charts).
 * Attachments are never authored by the model — only tool/server code creates them.
 */

import type { ChatAttachment } from "@/lib/types";
import { isAllowedSizeChartUrl } from "@/lib/shopify/size-chart-url";

/** Validate and narrow an unknown value to a size-chart attachment, or null. */
export function sanitizeSizeChartAttachment(
  value: unknown,
): ChatAttachment | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (obj.kind !== "size_chart") return null;

  const productId = typeof obj.productId === "string" ? obj.productId.trim() : "";
  const productTitle =
    typeof obj.productTitle === "string" ? obj.productTitle.trim() : "";
  const url = typeof obj.url === "string" ? obj.url.trim() : "";
  const altText = typeof obj.altText === "string" ? obj.altText.trim() : "";
  if (!productId || !productTitle || !url || !isAllowedSizeChartUrl(url)) {
    return null;
  }

  const width =
    typeof obj.width === "number" && Number.isFinite(obj.width) && obj.width > 0
      ? Math.floor(obj.width)
      : null;
  const height =
    typeof obj.height === "number" &&
    Number.isFinite(obj.height) &&
    obj.height > 0
      ? Math.floor(obj.height)
      : null;

  return {
    kind: "size_chart",
    productId,
    productTitle,
    url,
    altText: altText || `Size chart for ${productTitle}`,
    width,
    height,
  };
}

/** Filter an unknown attachments array down to verified size charts (max 3). */
export function sanitizeChatAttachments(
  value: unknown,
  max = 3,
): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: ChatAttachment[] = [];
  for (const item of value) {
    const chart = sanitizeSizeChartAttachment(item);
    if (chart) out.push(chart);
    if (out.length >= max) break;
  }
  return out;
}
