/**
 * Tunable limits and timeouts for the chat agent's tool-calling loop and
 * catalog pagination. Centralised so operational behaviour is configured in one
 * place rather than scattered across the orchestrator.
 */

export const MAX_TOOL_ROUNDS = 6;
export const OPENAI_TIMEOUT_MS = 45_000;
export const AGENT_WALL_CLOCK_MS = 55_000;
export const MAX_COMPLETION_TOKENS = 1_000;
/** Larger lists need more completion budget so we don't cut mid-list. */
export const LARGE_LIST_COMPLETION_TOKENS = 4_000;
/** Tool payload size (chars) above which we assume a long list is coming back. */
export const LARGE_PAYLOAD_CHARS = 1_500;
export const SEARCH_RESULT_LIMIT = 10;
/** Page size when answering "how many" / total counts for any category. */
export const COUNT_SEARCH_LIMIT = 50;
/** Safety cap on paginated count fetches. */
export const MAX_COUNT_PAGES = 5;
/**
 * @deprecated Prefer CATEGORY_PAYLOAD_PRODUCTS — kept for older count callers.
 * How many product rows to keep after a full count.
 */
export const COUNT_PAYLOAD_PRODUCTS = 15;
/**
 * How many products to keep in the tool/session payload for follow-ups.
 * Customer-facing shortlists show SHORTLIST_DISPLAY_LIMIT (5).
 */
export const CATEGORY_PAYLOAD_PRODUCTS = 20;
/** Explicit all/every/list requests: exact total + up to this many products. */
export const LIST_PAYLOAD_PRODUCTS = 20;
/** Customer-facing products shown initially in a listing. */
export const SHORTLIST_DISPLAY_LIMIT = 5;

/**
 * TEMP: order tracking is disabled. Flip to `true` to restore the
 * deterministic tracking state machine, track_order tool, and API route.
 */
export const ORDER_TRACKING_ENABLED = false;

/** Catalog tools whose (empty) results should drive the "no match" fallback. */
export const CATALOG_TOOLS = new Set<string>([
  "search_catalog",
  "get_product",
  "lookup_catalog",
]);
