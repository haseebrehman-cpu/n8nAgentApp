/**
 * Framing of Shopify MCP tool output for the model. Tool results are wrapped as
 * untrusted CATALOG_DATA (so the model never treats them as instructions) with
 * a trusted usage hint appended, and can be unwrapped again for inspection.
 */

/**
 * Wrap MCP tool output as untrusted CATALOG_DATA for the model, followed by a
 * trusted usage hint. The MCP server already returns storefront-ready facts
 * (titles, prices, availability, links, policy answers).
 */
export function wrapMcpResult(data: string, hint: string): string {
  const trimmed = data?.trim() ?? "";
  return `<CATALOG_DATA>\n${trimmed || "{}"}\n</CATALOG_DATA>\n\n${hint}`;
}

/** Pull the untrusted data section back out of a wrapped tool result. */
export function extractCatalogData(toolResult: string): string {
  const match = toolResult.match(
    /<CATALOG_DATA>\n?([\s\S]*?)\n?<\/CATALOG_DATA>/,
  );
  return match ? match[1]!.trim() : "";
}
