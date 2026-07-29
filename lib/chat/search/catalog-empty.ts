/**
 * Detect empty vs infrastructure-failed catalog tool payloads.
 * Compacted search with productCount:0 is empty; { error: "search_failed" }
 * is an infra failure and must not be treated as a successful empty browse.
 */

import { extractCatalogData } from "@/lib/chat/agent/mcp-format";

const INFRA_ERROR_CODES = new Set([
  "search_failed",
  "corrupt_catalog_payload",
  "lookup_failed",
  "The store connection is not ready yet. Apologize and say the service is temporarily unavailable.",
  "The lookup failed. Apologize and ask the customer to try again shortly.",
]);

function parseCatalogPayload(toolResult: string): Record<string, unknown> | null {
  if (!toolResult?.trim()) return null;
  const dataSection = extractCatalogData(toolResult) || toolResult.trim();
  if (!dataSection) return null;
  try {
    const parsed = JSON.parse(dataSection) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * True when a catalog tool failed due to infra / corrupt payload — not a
 * genuine "zero products matched" result.
 */
export function isCatalogInfraFailure(toolResult: string): boolean {
  const obj = parseCatalogPayload(toolResult);
  if (!obj) {
    // Wrapped non-JSON garbage after compact failure.
    const dataSection = extractCatalogData(toolResult) || toolResult.trim();
    if (dataSection && dataSection !== "{}" && !dataSection.startsWith("{")) {
      return true;
    }
    return false;
  }

  const err = obj.error;
  if (typeof err === "string") {
    if (INFRA_ERROR_CODES.has(err)) return true;
    if (/not ready|lookup failed|search_failed|corrupt|unavailable|temporarily/i.test(err)) {
      return true;
    }
  }
  return false;
}

/**
 * True when a catalog tool result contains no usable products.
 * Accepts wrapped CATALOG_DATA or raw compacted JSON.
 */
export function isEmptyCatalogResult(toolResult: string): boolean {
  if (!toolResult?.trim()) return true;
  if (isCatalogInfraFailure(toolResult)) return false;

  const dataSection = extractCatalogData(toolResult) || toolResult.trim();
  if (!dataSection || dataSection === "{}") return true;

  const obj = parseCatalogPayload(toolResult);
  if (!obj) {
    // Non-JSON tool errors that aren't infra — let the model handle carefully.
    return false;
  }

  // Soft tool errors (e.g. invalid_product_id) are not empty catalog.
  if (obj.error) return false;

  if (Array.isArray(obj.products)) {
    if (obj.products.length === 0) return true;
    if (typeof obj.productCount === "number" && obj.productCount <= 0) {
      return true;
    }
    return false;
  }

  if ("product" in obj) {
    return obj.product == null;
  }

  return false;
}
