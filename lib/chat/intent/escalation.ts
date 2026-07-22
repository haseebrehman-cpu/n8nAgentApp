/**
 * Detects when a customer explicitly wants to reach a human agent so the
 * assistant can escalate immediately instead of continuing to answer itself.
 * Kept narrow to unambiguous requests — general questions still flow to the
 * advisor.
 */

const AGENT = "(?:human|person|agent|representative|rep|advisor|someone|somebody)";

/**
 * "talk/speak/chat/connect/transfer/escalate ... to/with a human/agent/..."
 */
const CONTACT_HUMAN_RE = new RegExp(
  `\\b(?:talk|speak|chat|connect|transfer|escalate)\\b(?:\\s+\\w+){0,4}?\\s+(?:to|with)\\s+(?:a\\s+|an\\s+|the\\s+)?${AGENT}\\b`,
  "i",
);

/** "real/actual/live person", "human agent", explicit "customer service". */
const HUMAN_NOUN_RE =
  /\b(?:(?:real|actual|live)\s+(?:person|human|agent|representative)|human\s+(?:agent|support|being|help)|customer\s+(?:service|support))\b/i;

/** "(get|want|need) (me) a human/agent/representative". */
const WANT_HUMAN_RE =
  /\b(?:get|want|need)\s+(?:me\s+)?(?:a\s+|an\s+|to\s+)?(?:speak\s+to\s+)?(?:a\s+|an\s+)?(?:human|agent|representative|real\s+person)\b/i;

/** True when the customer clearly asks to be handed off to a human. */
export function isHumanEscalationRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    CONTACT_HUMAN_RE.test(t) || HUMAN_NOUN_RE.test(t) || WANT_HUMAN_RE.test(t)
  );
}
