/**
 * Retrying fetch for the public storefront JSON endpoints
 * (/collections.json, /collections/{handle}/products.json).
 *
 * These endpoints are rate limited per IP. Without retries a single 429 used to
 * abort a category load, and the caller silently fell back to MCP free-text
 * counting — which reports a different total for the same category. Retrying
 * keeps a category answer on one deterministic data source.
 */

const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 12_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function combineSignals(external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!external) return timeout;
  const anyFn = (
    AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }
  ).any;
  if (typeof anyFn === "function") return anyFn([timeout, external]);
  return external.aborted ? external : timeout;
}

/**
 * GET a storefront JSON endpoint, retrying 429/5xx with backoff.
 * `label` is used only in the thrown error message.
 */
export async function fetchStorefrontJson<T>(
  url: string,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  let lastStatus = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      signal: combineSignals(signal),
      headers: { Accept: "application/json" },
    });

    if (res.ok) return (await res.json()) as T;

    lastStatus = res.status;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS - 1) break;

    const retryAfter = Number(res.headers.get("Retry-After"));
    const backoffMs = Number.isFinite(retryAfter)
      ? Math.min(retryAfter * 1000, 5_000)
      : Math.min(600 * 2 ** attempt + Math.random() * 300, 5_000);
    await sleep(backoffMs, signal);
  }

  throw new Error(`Storefront ${label} fetch failed (${lastStatus})`);
}
