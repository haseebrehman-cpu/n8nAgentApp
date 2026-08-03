/**
 * RDX URL turn handler — early deterministic path for storefront deep-links.
 *
 * Detects URLs in the customer message, validates official RDX domains,
 * dispatches to Shopify MCP / storefront JSON, and returns a decision the
 * chat orchestrator can apply. Does not touch product search, order tracking,
 * or other intents when no URL is present.
 */

import { createCatalogRepository } from "@/lib/chat/repositories";
import type { ShownProduct } from "@/lib/chat/context/product-memory";
import {
  TEMPLATE_COMPARISON,
  TEMPLATE_PRODUCT_DETAILS,
} from "@/lib/chat/messaging/templates";
import { parseMessageUrls } from "@/lib/chat/url/parser";
import { detectRdxResourceType } from "@/lib/chat/url/resource-type";
import {
  dispatchRdxResources,
  type DispatchedResource,
} from "@/lib/chat/url/dispatcher";
import {
  INVALID_URL_REPLY,
  MCP_FAILURE_REPLY,
  NON_OFFICIAL_RDX_URL_REPLY,
  RESOURCE_NOT_FOUND_REPLY,
  UNSUPPORTED_RDX_PAGE_REPLY,
  buildUrlFallbackReply,
} from "@/lib/chat/url/replies";

export interface RdxUrlTurnInput {
  message: string;
  signal?: AbortSignal;
}

/** Subset of orchestrator decisions produced by the URL handler. */
export type RdxUrlDecision =
  | {
      kind: "final_reply";
      reply: string;
      intent: string;
      shownProducts?: ShownProduct[] | null;
    }
  | {
      kind: "llm_wrap";
      systemBlocks: string[];
      intent: string;
      shownProducts?: ShownProduct[] | null;
      searchQuery?: string | null;
      skipCatalogSearch: true;
      fallbackReply?: string;
    };

function finalReply(reply: string, intent = "rdx_url"): RdxUrlDecision {
  return { kind: "final_reply", reply, intent };
}

function buildGuidancePrompt(
  message: string,
  payloads: DispatchedResource[],
): string {
  const compare = payloads.length >= 2;
  const types = payloads.map((p) => p.resource.type);
  const allProducts = types.every((t) => t === "product");

  const dataBlocks = payloads
    .map(
      (p, i) =>
        `--- Resource ${i + 1}: ${p.label} (${p.resource.url.toString()}) ---\n${p.dataText}`,
    )
    .join("\n\n");

  const templateHint = compare
    ? allProducts
      ? `Use the Comparison template:\n${TEMPLATE_COMPARISON}`
      : "Compare the resources side by side using only the provided data. Name each by title/URL. Omit sections with no data."
    : payloads[0]?.resource.type === "product"
      ? `Use the Product details template:\n${TEMPLATE_PRODUCT_DETAILS}`
      : payloads[0]?.resource.type === "collection"
        ? "Summarize this collection and highlight a few notable products from the data. Include product cards with links when URLs/prices are present. Offer to narrow by size, colour, or budget."
        : "Summarize this page/article/policy clearly for the customer using only the provided data. Keep it concise and helpful.";

  return `RDX URL TURN (not a free-text catalog search):
The customer shared one or more official RDX Sports website links.
Customer message: "${message.trim()}"

RESOURCE DATA (sole source of truth — from Shopify MCP tools / official storefront JSON):
${dataBlocks}

Instructions:
- Answer using ONLY the resource data above. Never invent specs, prices, policies, or article content.
- ${templateHint}
- If the customer asked to compare, focus on differences and who each option suits.
- Never mention MCP, APIs, tools, JSON, or internal systems.
- Keep a warm store-associate tone.`.trim();
}

function buildFallbackFromPayloads(payloads: DispatchedResource[]): string {
  if (payloads.length === 0) return RESOURCE_NOT_FOUND_REPLY;

  if (payloads.length === 1) {
    const p = payloads[0]!;
    const titleGuess =
      p.shownProducts[0]?.title ||
      p.resource.handle.replace(/-/g, " ");
    if (p.resource.type === "product" && p.shownProducts[0]) {
      const prod = p.shownProducts[0];
      const price = prod.price ? `\n\n**Price:** ${prod.price}` : "";
      const link = prod.url ? `\n\n[View product](${prod.url})` : "";
      return buildUrlFallbackReply(
        "product",
        `Here's what I found for **${prod.title}**.${price}${link}\n\nAsk me about sizes, colours, or how it compares to another product.`,
      );
    }
    if (p.resource.type === "collection") {
      const count = p.shownProducts.length;
      const cards = p.shownProducts
        .slice(0, 5)
        .map((s) => {
          const price = s.price ? ` — ${s.price}` : "";
          const link = s.url ? ` ([View](${s.url}))` : "";
          return `- **${s.title}**${price}${link}`;
        })
        .join("\n");
      return `Here's the **${titleGuess}** collection${count ? ` (${count} products loaded)` : ""}.${cards ? `\n\n${cards}` : ""}\n\nWant me to narrow by size, colour, or budget?`;
    }
    return `I've looked up that ${p.label}. Ask me anything specific about it and I'll answer from the official store details.`;
  }

  const names = payloads
    .map((p) => p.shownProducts[0]?.title || p.resource.handle.replace(/-/g, " "))
    .join(" vs ");
  return `I've loaded details for **${names}**. Here's a quick comparison based on the official store data — ask if you want sizes, materials, or which suits your training.`;
}

/**
 * Attempt to handle a turn that contains RDX (or non-RDX) URLs.
 * Returns `null` when the message has no URL tokens — callers should continue
 * the normal chat flow unchanged.
 */
export async function tryResolveRdxUrlTurn(
  input: RdxUrlTurnInput,
): Promise<RdxUrlDecision | null> {
  const parsed = parseMessageUrls(input.message);
  if (parsed.rawUrls.length === 0) return null;

  if (parsed.hasNonOfficial) {
    return finalReply(NON_OFFICIAL_RDX_URL_REPLY, "rdx_url_rejected");
  }

  if (parsed.hasInvalid && parsed.rdxUrls.length === 0) {
    return finalReply(INVALID_URL_REPLY, "rdx_url_invalid");
  }

  if (parsed.rdxUrls.length === 0) {
    return finalReply(INVALID_URL_REPLY, "rdx_url_invalid");
  }

  const resources = [];
  for (const url of parsed.rdxUrls) {
    const detected = detectRdxResourceType(url);
    if (!detected.ok) {
      return finalReply(
        detected.reason === "missing_handle"
          ? INVALID_URL_REPLY
          : UNSUPPORTED_RDX_PAGE_REPLY,
        "rdx_url_unsupported",
      );
    }
    resources.push(detected.resource);
  }

  const catalogRepo = createCatalogRepository();
  const results = await dispatchRdxResources(
    resources,
    catalogRepo,
    input.signal,
  );

  const payloads: DispatchedResource[] = [];
  for (const result of results) {
    if (!result.ok) {
      if (result.reason === "not_found") {
        return finalReply(RESOURCE_NOT_FOUND_REPLY, "rdx_url_not_found");
      }
      return finalReply(MCP_FAILURE_REPLY, "rdx_url_mcp_failure");
    }
    payloads.push(result.payload);
  }

  const shownProducts: ShownProduct[] = [];
  for (const p of payloads) {
    for (const product of p.shownProducts) {
      if (shownProducts.some((s) => s.id === product.id)) continue;
      shownProducts.push(product);
      if (shownProducts.length >= 20) break;
    }
  }

  const guidance = buildGuidancePrompt(input.message, payloads);
  const fallback = buildFallbackFromPayloads(payloads);

  const searchQuery =
    payloads
      .map(
        (p) => p.shownProducts[0]?.title || p.resource.handle.replace(/-/g, " "),
      )
      .filter(Boolean)
      .join(", ") || null;

  return {
    kind: "llm_wrap",
    systemBlocks: [guidance],
    intent: payloads.length >= 2 ? "rdx_url_compare" : "rdx_url",
    shownProducts: shownProducts.length > 0 ? shownProducts : null,
    searchQuery,
    skipCatalogSearch: true,
    fallbackReply: fallback,
  };
}
