/**
 * High-level wrappers over Shopify's hosted Storefront MCP tools.
 *
 * The UCP catalog tools (`search_catalog`, `lookup_catalog`, `get_product`)
 * live on the `/api/ucp/mcp` endpoint, wrap their arguments in a `catalog`
 * object, and require an agent profile in `meta`. The policies/FAQ tool lives
 * on the standard `/api/mcp` endpoint and takes plain arguments.
 *
 * Each wrapper returns the raw text content produced by the MCP server, which
 * is already formatted for an agent to consume (product titles, prices, URLs,
 * availability, policy answers). Callers forward it to the model as-is.
 */

import { getShopifyConfig, getShopifyMcpConfig } from "@/lib/config";
import { callMcpTool, type McpCallOptions } from "@/lib/shopify/mcp-client";

/** Buyer signals for relevance and localization (UCP `context`). */
export interface CatalogContext {
  address_country?: string;
  intent?: string;
}

export interface SearchCatalogInput {
  query: string;
  intent?: string;
  context?: CatalogContext;
  filters?: Record<string, unknown>;
  pagination?: { cursor?: string; limit?: number };
}

export interface LookupCatalogInput {
  ids: string[];
  context?: CatalogContext;
  filters?: Record<string, unknown>;
}

export interface GetProductInput {
  id: string;
  selected?: { name: string; label: string }[];
  preferences?: string[];
  context?: CatalogContext;
  filters?: Record<string, unknown>;
}

export interface PoliciesInput {
  query: string;
  context?: string;
}

/** Derive a default buyer context from the configured market country. */
function defaultContext(extra?: CatalogContext): CatalogContext | undefined {
  const { marketCountry } = getShopifyConfig();
  const context: CatalogContext = { ...extra };
  if (marketCountry && !context.address_country) {
    context.address_country = marketCountry;
  }
  return Object.keys(context).length > 0 ? context : undefined;
}

/** Build the UCP `meta` block with the required agent profile. */
function ucpMeta(): Record<string, unknown> {
  const { agentProfile } = getShopifyMcpConfig();
  return { "ucp-agent": { profile: agentProfile } };
}

export async function searchCatalog(
  input: SearchCatalogInput,
  options: McpCallOptions = {}
): Promise<string> {
  const { ucpEndpoint } = getShopifyMcpConfig();
  const catalog: Record<string, unknown> = { query: input.query };

  const context = defaultContext({ ...input.context, intent: input.intent });
  if (context) catalog.context = context;
  if (input.filters) catalog.filters = input.filters;
  if (input.pagination) catalog.pagination = input.pagination;

  return callMcpTool(
    ucpEndpoint,
    "search_catalog",
    { meta: ucpMeta(), catalog },
    options
  );
}

export async function lookupCatalog(
  input: LookupCatalogInput,
  options: McpCallOptions = {}
): Promise<string> {
  const { ucpEndpoint } = getShopifyMcpConfig();
  const catalog: Record<string, unknown> = { ids: input.ids.slice(0, 10) };

  const context = defaultContext(input.context);
  if (context) catalog.context = context;
  if (input.filters) catalog.filters = input.filters;

  return callMcpTool(
    ucpEndpoint,
    "lookup_catalog",
    { meta: ucpMeta(), catalog },
    options
  );
}

export async function getProduct(
  input: GetProductInput,
  options: McpCallOptions = {}
): Promise<string> {
  const { ucpEndpoint } = getShopifyMcpConfig();
  const catalog: Record<string, unknown> = { id: input.id };

  if (input.selected?.length) catalog.selected = input.selected;
  if (input.preferences?.length) catalog.preferences = input.preferences;
  const context = defaultContext(input.context);
  if (context) catalog.context = context;
  if (input.filters) catalog.filters = input.filters;

  return callMcpTool(
    ucpEndpoint,
    "get_product",
    { meta: ucpMeta(), catalog },
    options
  );
}

export async function searchShopPoliciesAndFaqs(
  input: PoliciesInput,
  options: McpCallOptions = {}
): Promise<string> {
  const { standardEndpoint } = getShopifyMcpConfig();
  const args: Record<string, unknown> = { query: input.query };
  if (input.context) args.context = input.context;

  return callMcpTool(
    standardEndpoint,
    "search_shop_policies_and_faqs",
    args,
    options
  );
}
