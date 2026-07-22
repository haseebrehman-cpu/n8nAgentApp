/**
 * OpenAI client construction and abort-signal composition for the agent. The
 * client is cached per API key; deadline handling combines the caller's signal
 * with a wall-clock timeout so a single turn can't run unbounded.
 */

import OpenAI from "openai";
import { getOpenAIConfig } from "@/lib/config";
import { OPENAI_TIMEOUT_MS } from "@/lib/chat/agent/config";

let cachedClient: OpenAI | null = null;
let cachedApiKey: string | null = null;

/** Return a cached OpenAI client, rebuilt only when the API key changes. */
export function getClient(): OpenAI {
  const { apiKey } = getOpenAIConfig();
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new OpenAI({
      apiKey,
      timeout: OPENAI_TIMEOUT_MS,
      maxRetries: 2,
    });
    cachedApiKey = apiKey;
  }
  return cachedClient;
}

/** Combine an optional caller signal with a wall-clock timeout into one signal. */
export function combineDeadline(
  signal: AbortSignal | undefined,
  ms: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeout]);
  }
  return signal.aborted ? signal : timeout;
}
