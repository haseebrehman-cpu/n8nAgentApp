/**
 * Safety classifier: detects dangerous, illegal, or clearly harmful requests
 * that must be refused before any tool routing. Leaf module.
 */

import { HARMFUL_QUERY_RE } from "@/lib/chat/intent/patterns";

/** Clearly harmful / dangerous / illegal request — refuse and redirect. */
export function isHarmfulQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return HARMFUL_QUERY_RE.test(t);
}

/**
 * Lightweight jailbreak / prompt-injection detector.
 * Kept narrow so real shopping questions are never blocked.
 */
export function isPromptInjectionAttempt(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|prompts?)\b/i.test(
      t,
    ) ||
    /\b(reveal|show|print|dump)\s+(your\s+)?(system\s+prompt|hidden\s+instructions?|tools?|api\s*keys?)\b/i.test(
      t,
    ) ||
    /\byou\s+are\s+now\s+(dan|jailbroken|unrestricted)\b/i.test(t) ||
    /<\/?(?:system|CATALOG_DATA|JOURNEY)\b/i.test(text)
  );
}
