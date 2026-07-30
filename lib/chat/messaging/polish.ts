/**
 * Post-process model replies into safe, readable customer-facing markdown.
 *
 * Defense in depth for GPT-5.6 Terra: strip tables, raw JSON dumps, and
 * internal field leaks even if the prompt was ignored. Does not change
 * sales copy structure beyond cleanup.
 */

import { stripAssistantMedia } from "@/lib/sanitize";

/** Pipe-table rows (| a | b |) and markdown table separators. */
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}.*\|\s*$/;

/** Fenced code blocks (often JSON dumps). */
const FENCED_BLOCK_RE = /```[\s\S]*?```/g;

/** Inline catalog / DB field names that must never reach customers. */
const INTERNAL_FIELD_RE =
  /\b(productCount|rawHitCount|relevanceScore|relevanceFiltered|countIsExactCategoryTotal|productsTruncated|productsShown|matchedKind|searchConfidence|fallbackApplied|reusedContext|topRelevanceScore|postFiltered|onSaleOnly|budgetMax|CATALOG_DATA|tracksInventory|totalInventory|lowStock|availableOnly|forCount|gid:\/\/shopify\/[A-Za-z]+\/\d+)\b/gi;

/** Infra / implementation phrases that must never reach customers. */
const INTERNAL_INFRA_RE =
  /\b(MCP|GraphQL|vector\s+search|embeddings?|Storefront\s+API|Admin\s+API)\b/gi;

const INTERNAL_PHRASE_RE =
  /\b(I\s+searched(?:\s+the)?|the\s+tool\s+returned|the\s+API\s+returned|MCP\s+says)\b[^.!?\n]*/gi;

/**
 * Remove markdown tables line-by-line (GFM pipe tables).
 */
function stripMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = []; 
  for (const line of lines) {
    if (TABLE_ROW_RE.test(line) || TABLE_SEP_RE.test(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Drop fenced blocks that look like JSON / tool payloads; keep other fences rare.
 */
function stripJsonFences(text: string): string {
  return text.replace(FENCED_BLOCK_RE, (block) => {
    const inner = block.replace(/^```\w*\n?/, "").replace(/```$/, "").trim();
    if (
      inner.startsWith("{") ||
      inner.startsWith("[") ||
      /"products"\s*:/.test(inner) ||
      /"productCount"\s*:/.test(inner)
    ) {
      return "";
    }
    return inner;
  });
}

/** Collapse accidental raw JSON object dumps (single-line or multi-line). */
function stripRawJsonObjects(text: string): string {
  return text
    .replace(/\{\s*"products"\s*:\s*\[[\s\S]*?\}\s*(?=\n|$)/g, "")
    .replace(/\{\s*"productCount"\s*:\s*\d+[\s\S]*?\}\s*(?=\n|$)/g, "")
    .replace(/\{\s*"error"\s*:\s*"[^"]+"\s*\}/g, "");
}

function scrubInternalFields(text: string): string {
  return text
    .replace(INTERNAL_PHRASE_RE, "")
    .replace(INTERNAL_INFRA_RE, "")
    .replace(INTERNAL_FIELD_RE, "")
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * Drop consecutive duplicate product-card headings (### **Name**).
 */
function dedupeProductHeadings(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let lastHeading = "";
  for (const line of lines) {
    const m = line.match(/^###\s+\*\*(.+?)\*\*\s*$/);
    if (m) {
      const key = m[1]!.trim().toLowerCase();
      if (key && key === lastHeading) continue;
      lastHeading = key;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Polish a model (or canned) reply for customer display.
 * Always run before persisting / streaming to the client.
 */
export function polishCustomerReply(text: string): string {
  let out = stripAssistantMedia(text);
  out = stripJsonFences(out);
  out = stripMarkdownTables(out);
  out = stripRawJsonObjects(out);
  out = scrubInternalFields(out);
  out = dedupeProductHeadings(out);
  out = out
    .replace(/^[ \t]*[•●▪︎]/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return out;
}
