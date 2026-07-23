/**
 * Safety classifier: detects dangerous, illegal, or clearly harmful requests
 * that must be refused before any tool routing. Leaf module.
 */

// import { HARMFUL_QUERY_RE } from "@/lib/chat/intent/patterns";

/** Clearly harmful / dangerous / illegal request — refuse and redirect. */
/*export function isHarmfulQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  // return HARMFUL_QUERY_RE.test(t);
}*/
