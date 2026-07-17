/**
 * Shared Shopify Admin GraphQL client with timeout, throttle retries, and AbortSignal.
 */

import type { ShopifyStoreCredentials } from "@/services/shopify/credentials";
import { SHOPIFY_API_VERSION } from "@/services/shopify/credentials";
import { getShopifyConfig } from "@/lib/config";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

export interface ShopifyGraphqlOptions {
  credentials?: ShopifyStoreCredentials;
  signal?: AbortSignal;
  timeoutMs?: number;
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

function combineSignals(
  timeoutMs: number,
  external?: AbortSignal
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeout, external]);
  }
  return external.aborted ? external : timeout;
}

function isThrottled(
  status: number,
  errors?: { message: string; extensions?: { code?: string } }[]
): boolean {
  if (status === 429) return true;
  return Boolean(
    errors?.some(
      (e) =>
        e.extensions?.code === "THROTTLED" ||
        /throttl/i.test(e.message)
    )
  );
}

function resolveCredentials(
  credentials?: ShopifyStoreCredentials
): ShopifyStoreCredentials {
  if (credentials) return credentials;
  const { domain, accessToken } = getShopifyConfig();
  return {
    region: "default",
    domain,
    accessToken,
    apiVersion: SHOPIFY_API_VERSION,
  };
}

/**
 * Execute a Shopify Admin GraphQL query with retries on HTTP 429 / THROTTLED.
 */
export async function shopifyAdminGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  options: ShopifyGraphqlOptions = {}
): Promise<T> {
  const credentials = resolveCredentials(options.credentials);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const url = `https://${credentials.domain}/admin/api/${credentials.apiVersion}/graphql.json`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    const signal = combineSignals(timeoutMs, options.signal);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": credentials.accessToken,
        },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        signal,
      });

      const json = (await res.json()) as {
        data?: T;
        errors?: { message: string; extensions?: { code?: string } }[];
      };

      if (isThrottled(res.status, json.errors)) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        const backoffMs = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : Math.min(1000 * 2 ** attempt + Math.random() * 250, 8_000);
        lastError = new Error(
          `Shopify throttled (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        if (attempt < MAX_RETRIES - 1) {
          await sleep(backoffMs, options.signal);
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        throw new Error(
          `Shopify API error ${res.status}: ${JSON.stringify(json.errors ?? {}).slice(0, 300)}`
        );
      }

      if (json.errors?.length) {
        throw new Error(
          `Shopify GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`
        );
      }

      return json.data as T;
    } catch (err) {
      if (
        err instanceof Error &&
        (err.name === "AbortError" || /aborted/i.test(err.message))
      ) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES - 1 && /throttl|429|ECONNRESET|ETIMEDOUT/i.test(lastError.message)) {
        await sleep(Math.min(1000 * 2 ** attempt + Math.random() * 250, 8_000), options.signal);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("Shopify request failed");
}
