/**
 * Low-level client for Shopify's hosted Storefront MCP servers.
 *
 * Speaks JSON-RPC 2.0 (`tools/call`) over HTTP against the store's public
 * MCP endpoints. Includes per-attempt timeout, retries on throttle / network /
 * timeout / corrupt JSON, and AbortSignal support. Client disconnects are
 * never retried.
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

/**
 * Combine a per-attempt timeout with an optional external cancel signal.
 * When AbortSignal.any is unavailable, abort whichever fires first.
 */
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
  // Polyfill: abort when either signal aborts.
  if (external.aborted) return external;
  const controller = new AbortController();
  const onAbort = () => {
    try {
      controller.abort(
        external.aborted
          ? (external.reason ?? new DOMException("Aborted", "AbortError"))
          : new DOMException("Timeout", "TimeoutError"),
      );
    } catch {
      controller.abort();
    }
  };
  external.addEventListener("abort", onAbort, { once: true });
  timeout.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

function isAbort(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      /aborted|timeout/i.test(err.message))
  );
}

/** True when the caller cancelled (do not retry). */
function isExternalAbort(err: unknown, external?: AbortSignal): boolean {
  if (external?.aborted) return true;
  if (!(err instanceof Error)) return false;
  // TimeoutError / "Timeout" from our timer should be retryable.
  if (err.name === "TimeoutError" || /^timeout$/i.test(err.message)) {
    return false;
  }
  return err.name === "AbortError" || /aborted/i.test(err.message);
}

function isRetryableError(err: Error): boolean {
  return /429|5\d\d|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network|timeout|TimeoutError|Unexpected token|JSON/i.test(
    `${err.name} ${err.message}`,
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
  options: McpCallOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    id: 1,
    params: { name, arguments: args },
  });

  let lastError: Error | null = null;
  const started = Date.now();

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
          `Shopify MCP ${res.status} for "${name}" (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        logger.warn("shopify-mcp", "retryable HTTP status", {
          tool: name,
          status: res.status,
          attempt: attempt + 1,
          backoffMs,
        });
        if (attempt < MAX_RETRIES - 1) {
          await sleep(backoffMs, options.signal);
          continue;
        }
        throw lastError;
      }

      let json: JsonRpcResponse;
      try {
        json = (await res.json()) as JsonRpcResponse;
      } catch (parseErr) {
        lastError =
          parseErr instanceof Error
            ? parseErr
            : new Error("Shopify MCP returned invalid JSON");
        logger.warn("shopify-mcp", "corrupt JSON body", {
          tool: name,
          attempt: attempt + 1,
          error: lastError.message,
        });
        if (attempt < MAX_RETRIES - 1) {
          await sleep(
            Math.min(1000 * 2 ** attempt + Math.random() * 250, 8_000),
            options.signal,
          );
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        throw new Error(
          `Shopify MCP HTTP ${res.status} for "${name}": ${
            json.error?.message ?? res.statusText
          }`,
        );
      }

      if (json.error) {
        throw new Error(
          `Shopify MCP error for "${name}": ${json.error.message ?? "unknown error"}`,
        );
      }

      const text = extractText(json.result?.content);

      if (json.result?.isError) {
        throw new Error(
          `Shopify MCP tool "${name}" returned an error: ${text || "unknown error"}`,
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
        ms: Date.now() - started,
      });

      return text;
    } catch (err) {
      // Client disconnect / parent abort — never retry.
      if (isExternalAbort(err, options.signal)) {
        throw err instanceof Error
          ? err
          : new DOMException("Aborted", "AbortError");
      }

      lastError = err instanceof Error ? err : new Error(String(err));
      const retryable =
        attempt < MAX_RETRIES - 1 &&
        (isRetryableError(lastError) || isAbort(err));

      if (retryable) {
        logger.warn("shopify-mcp", "retrying after error", {
          tool: name,
          attempt: attempt + 1,
          error: lastError.message,
          name: lastError.name,
        });
        await sleep(
          Math.min(1000 * 2 ** attempt + Math.random() * 250, 8_000),
          options.signal,
        );
        continue;
      }
      logger.error("shopify-mcp", "tools/call failed", {
        tool: name,
        attempt: attempt + 1,
        ms: Date.now() - started,
        error: lastError.message,
      });
      throw lastError;
    }
  }

  throw lastError ?? new Error(`Shopify MCP request failed for "${name}"`);
}
