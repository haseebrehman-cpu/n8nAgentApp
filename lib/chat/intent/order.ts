/**
 * Order-tracking intent detection and order/email extraction. Leaf module:
 * depends only on order-tracking validation helpers and shared patterns.
 */

import {
  isValidOrderNumberInput,
  normalizeEmail,
  normalizeOrderNumber,
} from "@/lib/chatbot/orderTracking";
import { ORDER_TRACKING_INTENT_RE } from "@/lib/chat/intent/patterns";

/** True when the message expresses an order-tracking intent. */
export function isOrderTrackingIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/^track your order$/i.test(t)) return true;
  return ORDER_TRACKING_INTENT_RE.test(t);
}

/** Bare token that looks like an order number (e.g. 1001, #1001, OT-xxx) — not a sentence. */
export function isBareOrderNumberToken(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  return isValidOrderNumberInput(t);
}

/** Normalize any order number found anywhere in the text. */
export function extractOrderNumberFromText(text: string): string | null {
  return normalizeOrderNumber(text);
}

/** Extract and normalize the first email address found in the text. */
export function extractEmailFromText(text: string): string | null {
  const match = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  if (!match) return null;
  return normalizeEmail(match[0]);
}

/** Remove order-tracking phrasing so any remaining token can be inspected. */
export function stripOrderTrackingPhrases(text: string): string {
  return text.replace(ORDER_TRACKING_INTENT_RE, "").trim();
}

/**
 * Idle-state order lookup tokens: bare "1001" / "#1001" / "OT-xxx",
 * or short "find/check/order 1001" (not product phrases).
 */
export function extractOrderLookupToken(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (isBareOrderNumberToken(t)) return normalizeOrderNumber(t);

  const prefixed = t.match(
    /^(?:find|search|check|lookup|look\s+up|order(?:\s*(?:number|no\.?|#))?)\s+[#:]?\s*([A-Za-z0-9][\w.-]{0,39})$/i,
  );
  if (prefixed?.[1] && isBareOrderNumberToken(prefixed[1])) {
    return normalizeOrderNumber(prefixed[1]);
  }
  return null;
}
