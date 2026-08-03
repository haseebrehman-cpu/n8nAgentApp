/**
 * MCP dispatcher — resolve an RDX URL resource via Shopify MCP tools.
 *
 * Handles are resolved through official storefront JSON endpoints (not HTML
 * scraping). Answers always come from MCP tool payloads (or, for CMS pages /
 * blog articles with no dedicated MCP tool, the storefront JSON body that is
 * the same source Shopify exposes for those resources).
 */

import type { ICatalogRepository } from "@/lib/chat/repositories/types";
import type { ShownProduct } from "@/lib/chat/context/product-memory";
import { extractShownProducts } from "@/lib/chat/context/product-memory";
import { wrapMcpResult } from "@/lib/chat/agent/mcp-format";
import { compactCatalogMcpText } from "@/lib/shopify/compact-catalog";
import { toShopifyProductGid } from "@/lib/shopify/gid";
import { fetchStorefrontJson } from "@/lib/shopify/storefront-json";
import { storefrontCatalogOrigin } from "@/lib/shopify/storefront-origin";
import { fetchStorefrontCollectionProducts } from "@/lib/shopify/storefront-collection";
import { lookupCatalog } from "@/lib/shopify/storefront-mcp";
import type { DetectedRdxResource } from "@/lib/chat/url/resource-type";
import { resourceTypeLabel } from "@/lib/chat/url/resource-type";

export type DispatchErrorReason =
  | "not_found"
  | "mcp_failure"
  | "invalid_handle";

export interface DispatchedResource {
  resource: DetectedRdxResource;
  /** Compact / policy text for the model (sole source of truth). */
  dataText: string;
  /** Products extracted for session memory when applicable. */
  shownProducts: ShownProduct[];
  label: string;
}

export type DispatchResult =
  | { ok: true; payload: DispatchedResource }
  | { ok: false; reason: DispatchErrorReason; message?: string };

interface AjaxProductResponse {
  product?: {
    id?: number | string;
    title?: string;
    handle?: string;
  };
}

interface AjaxPageResponse {
  page?: {
    id?: number | string;
    title?: string;
    handle?: string;
    body_html?: string;
    author?: string;
  };
}

interface AjaxArticleResponse {
  article?: {
    id?: number | string;
    title?: string;
    handle?: string;
    author?: string;
    summary_html?: string;
    body_html?: string;
    published_at?: string;
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function isNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(404|not\s*found|failed \(404\))\b/i.test(msg);
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

async function resolveProductId(
  handle: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const origin = storefrontCatalogOrigin();
  const url = `${origin}/products/${encodeURIComponent(handle)}.json`;
  try {
    const data = await fetchStorefrontJson<AjaxProductResponse>(
      url,
      `product ${handle}`,
      signal,
    );
    const id = data.product?.id;
    if (id == null) return null;
    return toShopifyProductGid(String(id));
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

async function dispatchProduct(
  resource: DetectedRdxResource,
  catalogRepo: ICatalogRepository,
  signal?: AbortSignal,
): Promise<DispatchResult> {
  try {
    const gid = await resolveProductId(resource.handle, signal);
    if (!gid) return { ok: false, reason: "not_found" };

    const raw = await catalogRepo.getProduct(gid, signal);
    const compact = compactCatalogMcpText(raw, { fullDescription: true });
    const wrapped = wrapMcpResult(
      compact,
      "Full details for this product from Shopify MCP get_product. Use ONLY these facts. IMPORTANT: The 'summary' field contains the product description — ALWAYS check it first for specifications (weight, fill level, material, pre-filled status, dimensions, features) before saying any attribute is unavailable. Never invent specs.",
    );
    return {
      ok: true,
      payload: {
        resource,
        dataText: wrapped,
        shownProducts: extractShownProducts(wrapped),
        label: resourceTypeLabel(resource.type),
      },
    };
  } catch (err) {
    if (isAbortError(err)) return { ok: false, reason: "mcp_failure" };
    const msg = err instanceof Error ? err.message : String(err);
    if (/product_not_found/i.test(msg) || isNotFoundError(err)) {
      return { ok: false, reason: "not_found" };
    }
    return { ok: false, reason: "mcp_failure", message: msg };
  }
}

async function dispatchCollection(
  resource: DetectedRdxResource,
  signal?: AbortSignal,
): Promise<DispatchResult> {
  try {
    const collectionJson = await fetchStorefrontCollectionProducts(
      resource.handle,
      { signal },
    );
    const parsed = JSON.parse(collectionJson) as {
      products?: { id?: string }[];
      collection?: { title?: string; handle?: string };
    };
    const ids = (parsed.products ?? [])
      .map((p) => String(p.id ?? "").trim())
      .filter(Boolean)
      .slice(0, 10);

    if (ids.length === 0) {
      // Empty collection is still a valid resource — surface collection meta.
      const emptyPayload = wrapMcpResult(
        JSON.stringify({
          collection: parsed.collection ?? {
            handle: resource.handle,
            title: resource.handle,
          },
          products: [],
        }),
        "Collection loaded from the storefront; no products were returned.",
      );
      return {
        ok: true,
        payload: {
          resource,
          dataText: emptyPayload,
          shownProducts: [],
          label: resourceTypeLabel(resource.type),
        },
      };
    }

    // Prefer MCP lookup_catalog so the answer is grounded in MCP product data.
    try {
      const mcpRaw = await lookupCatalog({ ids }, { signal });
      const compact = compactCatalogMcpText(mcpRaw);
      let productsPayload: Record<string, unknown> = {};
      try {
        productsPayload = JSON.parse(compact || "{}") as Record<string, unknown>;
      } catch {
        productsPayload = { products: [] };
      }
      const enriched = JSON.stringify({
        collection: parsed.collection ?? {
          handle: resource.handle,
          title: resource.handle,
        },
        ...productsPayload,
      });
      const wrapped = wrapMcpResult(
        enriched,
        "Collection products from Shopify MCP lookup_catalog. Use ONLY these facts.",
      );
      return {
        ok: true,
        payload: {
          resource,
          dataText: wrapped,
          shownProducts: extractShownProducts(wrapped),
          label: resourceTypeLabel(resource.type),
        },
      };
    } catch (mcpErr) {
      if (isAbortError(mcpErr)) return { ok: false, reason: "mcp_failure" };
      // Fall back to compacted collection JSON if MCP lookup fails.
      const compact = compactCatalogMcpText(collectionJson);
      const wrapped = wrapMcpResult(
        compact,
        "Collection products from the official storefront collection feed (MCP lookup unavailable). Use ONLY these facts.",
      );
      return {
        ok: true,
        payload: {
          resource,
          dataText: wrapped,
          shownProducts: extractShownProducts(wrapped),
          label: resourceTypeLabel(resource.type),
        },
      };
    }
  } catch (err) {
    if (isAbortError(err)) return { ok: false, reason: "mcp_failure" };
    if (isNotFoundError(err)) return { ok: false, reason: "not_found" };
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "mcp_failure", message: msg };
  }
}

async function dispatchPolicy(
  resource: DetectedRdxResource,
  catalogRepo: ICatalogRepository,
  signal?: AbortSignal,
): Promise<DispatchResult> {
  const query = resource.handle.replace(/-/g, " ");
  try {
    const raw = await catalogRepo.searchPolicies(
      `${query} ${resource.handle} site policy`,
      signal,
    );
    if (!raw?.trim()) return { ok: false, reason: "not_found" };
    const wrapped = wrapMcpResult(
      raw.trim(),
      "Official policy / FAQ text from Shopify MCP search_shop_policies_and_faqs. Use ONLY these facts.",
    );
    return {
      ok: true,
      payload: {
        resource,
        dataText: wrapped,
        shownProducts: [],
        label: resourceTypeLabel(resource.type),
      },
    };
  } catch (err) {
    if (isAbortError(err)) return { ok: false, reason: "mcp_failure" };
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "mcp_failure", message: msg };
  }
}

async function dispatchPage(
  resource: DetectedRdxResource,
  catalogRepo: ICatalogRepository,
  signal?: AbortSignal,
): Promise<DispatchResult> {
  const origin = storefrontCatalogOrigin();
  const pageUrl = `${origin}/pages/${encodeURIComponent(resource.handle)}.json`;

  try {
    const pageData = await fetchStorefrontJson<AjaxPageResponse>(
      pageUrl,
      `page ${resource.handle}`,
      signal,
    );
    const page = pageData.page;
    if (!page?.title) return { ok: false, reason: "not_found" };

    const body = stripHtml(String(page.body_html ?? "")).slice(0, 6000);

    // Enrich with MCP policies/FAQ when the page overlaps store policies.
    let policyText = "";
    try {
      policyText = (
        await catalogRepo.searchPolicies(
          `${page.title} ${resource.handle}`,
          signal,
        )
      ).trim();
    } catch {
      policyText = "";
    }

    const payload = {
      page: {
        title: page.title,
        handle: page.handle ?? resource.handle,
        url: resource.url.toString(),
        body: body || null,
      },
      related_policies_mcp: policyText || null,
    };

    const wrapped = wrapMcpResult(
      JSON.stringify(payload),
      "Official store page content (storefront JSON) plus any related Shopify MCP policy/FAQ text. Use ONLY these facts. Never invent page content.",
    );
    return {
      ok: true,
      payload: {
        resource,
        dataText: wrapped,
        shownProducts: [],
        label: resourceTypeLabel(resource.type),
      },
    };
  } catch (err) {
    if (isAbortError(err)) return { ok: false, reason: "mcp_failure" };
    if (isNotFoundError(err)) return { ok: false, reason: "not_found" };
    // Fallback: policies MCP alone when page JSON is unavailable.
    try {
      const raw = await catalogRepo.searchPolicies(
        resource.handle.replace(/-/g, " "),
        signal,
      );
      if (raw?.trim()) {
        const wrapped = wrapMcpResult(
          raw.trim(),
          "Related store content from Shopify MCP search_shop_policies_and_faqs. Use ONLY these facts.",
        );
        return {
          ok: true,
          payload: {
            resource,
            dataText: wrapped,
            shownProducts: [],
            label: resourceTypeLabel(resource.type),
          },
        };
      }
    } catch {
      // fall through
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "mcp_failure", message: msg };
  }
}

async function dispatchBlog(
  resource: DetectedRdxResource,
  signal?: AbortSignal,
): Promise<DispatchResult> {
  const blogHandle = resource.blogHandle;
  if (!blogHandle) return { ok: false, reason: "invalid_handle" };

  const origin = storefrontCatalogOrigin();
  const articleUrl = `${origin}/blogs/${encodeURIComponent(blogHandle)}/articles/${encodeURIComponent(resource.handle)}.json`;

  try {
    const data = await fetchStorefrontJson<AjaxArticleResponse>(
      articleUrl,
      `article ${blogHandle}/${resource.handle}`,
      signal,
    );
    const article = data.article;
    if (!article?.title) return { ok: false, reason: "not_found" };

    const summary = stripHtml(String(article.summary_html ?? ""));
    const body = stripHtml(String(article.body_html ?? "")).slice(0, 6000);
    const payload = {
      article: {
        title: article.title,
        handle: article.handle ?? resource.handle,
        blogHandle,
        author: article.author ?? null,
        published_at: article.published_at ?? null,
        url: resource.url.toString(),
        summary: summary || null,
        body: body || null,
      },
    };
    const wrapped = wrapMcpResult(
      JSON.stringify(payload),
      "Official blog article content from the RDX storefront JSON API (Shopify has no dedicated blog MCP tool). Use ONLY these facts. Never invent article content.",
    );
    return {
      ok: true,
      payload: {
        resource,
        dataText: wrapped,
        shownProducts: [],
        label: resourceTypeLabel(resource.type),
      },
    };
  } catch (err) {
    if (isAbortError(err)) return { ok: false, reason: "mcp_failure" };
    if (isNotFoundError(err)) return { ok: false, reason: "not_found" };
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "mcp_failure", message: msg };
  }
}

/** Resolve one detected RDX resource through the appropriate MCP / store API. */
export async function dispatchRdxResource(
  resource: DetectedRdxResource,
  catalogRepo: ICatalogRepository,
  signal?: AbortSignal,
): Promise<DispatchResult> {
  switch (resource.type) {
    case "product":
      return dispatchProduct(resource, catalogRepo, signal);
    case "collection":
      return dispatchCollection(resource, signal);
    case "policy":
      return dispatchPolicy(resource, catalogRepo, signal);
    case "page":
      return dispatchPage(resource, catalogRepo, signal);
    case "blog":
      return dispatchBlog(resource, signal);
  }
}

/** Resolve several resources (e.g. compare two URLs). Stops on first hard failure. */
export async function dispatchRdxResources(
  resources: DetectedRdxResource[],
  catalogRepo: ICatalogRepository,
  signal?: AbortSignal,
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  for (const resource of resources) {
    results.push(await dispatchRdxResource(resource, catalogRepo, signal));
  }
  return results;
}
