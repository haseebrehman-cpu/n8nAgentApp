/**
 * Low-level client for Shopify's hosted Storefront MCP servers.
 *
 * Speaks JSON-RPC 2.0 (`tools/call`) over HTTP against the store's public
 * MCP endpoints. These endpoints require no authentication — only the store
 * domain and a `Content-Type` header. Includes a request timeout, retries on
 * throttling/network errors, and `AbortSignal` support.
 */

import { logger } from "@/lib/logger";

/** Per-attempt budget; Shopify MCP is often slower from Vercel than localhost. */
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 3;

export interface McpCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface McpContentPart {
  type: string;
  text?: string;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: {
    content?: McpContentPart[];
    isError?: boolean;
  };
  error?: { code?: number; message?: string; data?: unknown };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function combineSignals(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  const anyFn = (
    AbortSignal as unknown as {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anyFn === "function") {
    return anyFn([timeout, external]);
  }
  return external.aborted ? external : timeout;
}

function isAbort(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /aborted/i.test(err.message))
  );
}

/** Concatenate the text parts of an MCP tool result into a single string. */
function extractText(content: McpContentPart[] | undefined): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .trim();
}

/**
 * Call a single tool on a Shopify MCP endpoint and return the text content of
 * the result. Throws on transport errors, JSON-RPC errors, or tool-level
 * errors (`result.isError`).
 */
export async function callMcpTool(
  endpoint: string,
  name: string,
  args: Record<string, unknown>,
  options: McpCallOptions = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    id: 1,
    params: { name, arguments: args },
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    const signal = combineSignals(timeoutMs, options.signal);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
        cache: "no-store",
        signal,
      });

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        const backoffMs = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : Math.min(1000 * 2 ** attempt + Math.random() * 250, 8_000);
        lastError = new Error(
          `Shopify MCP ${res.status} for "${name}" (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        if (attempt < MAX_RETRIES - 1) {
          await sleep(backoffMs, options.signal);
          continue;
        }
        throw lastError;
      }

      const json = (await res.json()) as JsonRpcResponse;

      if (!res.ok) {
        throw new Error(
          `Shopify MCP HTTP ${res.status} for "${name}": ${
            json.error?.message ?? res.statusText
          }`
        );
      }

      if (json.error) {
        throw new Error(
          `Shopify MCP error for "${name}": ${json.error.message ?? "unknown error"}`
        );
      }

      const text = extractText(json.result?.content);

      if (json.result?.isError) {
        throw new Error(
          `Shopify MCP tool "${name}" returned an error: ${text || "unknown error"}`
        );
      }

      let host = endpoint;
      try {
        host = new URL(endpoint).pathname.includes("/ucp/")
          ? `${new URL(endpoint).host}/api/ucp/mcp`
          : `${new URL(endpoint).host}/api/mcp`;
      } catch {
        // keep raw endpoint
      }
      logger.info("shopify-mcp", "tools/call ok", {
        tool: name,
        endpoint: host,
        bytes: text.length,
        attempt: attempt + 1,
      });

      return text;
    } catch (err) {
      if (isAbort(err)) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (
        attempt < MAX_RETRIES - 1 &&
        /429|5\d\d|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(
          lastError.message
        )
      ) {
        await sleep(
          Math.min(1000 * 2 ** attempt + Math.random() * 250, 8_000),
          options.signal
        );
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error(`Shopify MCP request failed for "${name}"`);
}
