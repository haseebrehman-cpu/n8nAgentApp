/**
 * Server-side chat session: history + conversation state machine.
 *
 * Hot path: Redis (multi-instance safe) with in-memory fallback for local/dev.
 * Durability: Mongo stores the full transcript + structured product context so
 * sessions can be repaired after Redis TTL/restart. Clients never author
 * assistant turns — only the latest user message is accepted.
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import {
  hydrateSessionFromMongo,
  persistChatToMongo,
} from "@/lib/chat/persist-mongo";
import {
  normalizeCatalogContext,
  type ConversationCatalogContext,
} from "@/lib/chat/context/conversation-context";
import {
  normalizeShownProducts,
  type ShownProduct,
} from "@/lib/chat/context/product-memory";
import { logger } from "@/lib/logger";
import { getRedis, redisKey } from "@/lib/redis";
import type { ChatMessagePayload } from "@/lib/types";

export type ConversationState =
  | "idle"
  | "awaiting_order_number"
  | "awaiting_order_email";

export interface ChatSession {
  id: string;
  messages: ChatMessagePayload[];
  /** Latest classified turn intent (e.g. product_information, order_tracking). */
  intent: string | null;
  /** Cumulative OpenAI usage for this session. */
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  state: ConversationState;
  /** Pending order number while awaiting email verification. */
  pendingOrderNumber: string | null;
  /** Last category/productType discussed (for follow-ups like "list the ones in stock"). */
  pendingCategory: string | null;
  /** Products most recently shown — resolves follow-ups like "these in red". */
  lastShownProducts: ShownProduct[] | null;
  /**
   * Last successful catalog search query (after rewrite). Used to merge
   * attribute follow-ups ("only blue ones") into a full semantic query.
   */
  lastSearchQuery: string | null;
  /**
   * Frozen catalog conversation memory: canonical search, products, filters,
   * preferences. Follow-ups reuse this before issuing a new live search.
   */
  catalogContext: ConversationCatalogContext | null;
  /** Optimistic concurrency token — incremented on every successful persist. */
  version: number;
  updatedAt: number;
}

const SESSION_TTL_SECONDS = 60 * 60 * 4; // 4 hours
const LOCK_TTL_SECONDS = 90;
/** Live agent/Redis context window — Mongo keeps the full transcript via appends. */
const MAX_HISTORY_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 2_000;
const COOKIE_NAME = "chat_session";

/**
 * Compare-and-swap persist: only overwrite when the stored version still matches
 * the version we loaded (ARGV[2]). Then write the new payload (ARGV[1]) with TTL.
 */
const SESSION_CAS_LUA = `
local cur = redis.call('GET', KEYS[1])
local expected = tonumber(ARGV[2])
if cur then
  local ok, obj = pcall(cjson.decode, cur)
  if ok and type(obj) == 'table' and obj['version'] ~= nil then
    if tonumber(obj['version']) ~= expected then
      return 0
    end
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
return 1
`;

const LOCK_RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const memorySessions = new Map<string, ChatSession>();
const memoryLocks = new Map<string, { token: string; expiresAt: number }>();
/** Request-scoped messages to append to Mongo (not stored in Redis). */
const pendingMongoBySession = new WeakMap<ChatSession, ChatMessagePayload[]>();

export class SessionConflictError extends Error {
  constructor(message = "Session was updated by another request") {
    super(message);
    this.name = "SessionConflictError";
  }
}

export class SessionBusyError extends Error {
  constructor(message = "Session is busy processing another message") {
    super(message);
    this.name = "SessionBusyError";
  }
}

function sessionRedisKey(id: string): string {
  return redisKey("chat", "session", id);
}

function sessionLockKey(id: string): string {
  return redisKey("chat", "lock", id);
}

function trimHistory(messages: ChatMessagePayload[]): ChatMessagePayload[] {
  return messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    role: m.role,
    content: m.content.slice(0, MAX_MESSAGE_CHARS),
  }));
}

function cloneSession(session: ChatSession): ChatSession {
  return {
    id: session.id,
    messages: trimHistory(session.messages),
    intent: session.intent,
    promptTokens: session.promptTokens,
    completionTokens: session.completionTokens,
    totalTokens: session.totalTokens,
    state: session.state,
    pendingOrderNumber: session.pendingOrderNumber,
    pendingCategory: session.pendingCategory,
    lastShownProducts: session.lastShownProducts
      ? session.lastShownProducts.map((p) => ({ ...p }))
      : null,
    lastSearchQuery: session.lastSearchQuery,
    catalogContext: session.catalogContext
      ? {
          ...session.catalogContext,
          products: session.catalogContext.products.map((p) => ({ ...p })),
          matchingProductIds: [...session.catalogContext.matchingProductIds],
          previousRecommendationIds: [
            ...session.catalogContext.previousRecommendationIds,
          ],
          filters: { ...session.catalogContext.filters },
          preferences: {
            ...session.catalogContext.preferences,
            goals: session.catalogContext.preferences.goals
              ? [...session.catalogContext.preferences.goals]
              : undefined,
          },
        }
      : null,
    version: session.version,
    updatedAt: session.updatedAt,
  };
}

function queueMongoMessage(
  session: ChatSession,
  message: ChatMessagePayload,
): void {
  const pending = pendingMongoBySession.get(session) ?? [];
  pending.push(message);
  pendingMongoBySession.set(session, pending);
}

function takePendingMongoMessages(session: ChatSession): ChatMessagePayload[] {
  const pending = pendingMongoBySession.get(session) ?? [];
  pendingMongoBySession.delete(session);
  return pending;
}

function emptySession(id: string): ChatSession {
  return {
    id,
    messages: [],
    state: "idle",
    pendingOrderNumber: null,
    pendingCategory: null,
    lastShownProducts: null,
    lastSearchQuery: null,
    catalogContext: null,
    version: 0,
    updatedAt: Date.now(),
    intent: null,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

function asNonNegativeInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function asConversationState(value: unknown): ConversationState {
  if (
    value === "idle" ||
    value === "awaiting_order_number" ||
    value === "awaiting_order_email"
  ) {
    return value;
  }
  return "idle";
}

function normalizeSession(parsed: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    id: parsed.id,
    messages: trimHistory(
      Array.isArray(parsed.messages) ? parsed.messages : [],
    ),
    state: asConversationState(parsed.state),
    pendingOrderNumber:
      typeof parsed.pendingOrderNumber === "string"
        ? parsed.pendingOrderNumber
        : null,
    pendingCategory:
      typeof parsed.pendingCategory === "string"
        ? parsed.pendingCategory
        : null,
    lastShownProducts: normalizeShownProducts(parsed.lastShownProducts),
    lastSearchQuery:
      typeof parsed.lastSearchQuery === "string" &&
      parsed.lastSearchQuery.trim()
        ? parsed.lastSearchQuery.trim()
        : null,
    catalogContext: normalizeCatalogContext(parsed.catalogContext),
    version: asNonNegativeInt(parsed.version),
    updatedAt:
      typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : Date.now(),
    intent: typeof parsed.intent === "string" ? parsed.intent : null,
    promptTokens: asNonNegativeInt(parsed.promptTokens),
    completionTokens: asNonNegativeInt(parsed.completionTokens),
    totalTokens: asNonNegativeInt(parsed.totalTokens),
  };
}

async function loadSessionFromRedis(id: string): Promise<ChatSession | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(sessionRedisKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChatSession>;
    if (!parsed?.id || !Array.isArray(parsed.messages)) return null;
    return normalizeSession({ ...parsed, id: parsed.id });
  } catch {
    return null;
  }
}

async function loadSessionFromMemory(id: string): Promise<ChatSession | null> {
  const mem = memorySessions.get(id);
  if (!mem) return null;
  if (Date.now() - mem.updatedAt > SESSION_TTL_SECONDS * 1000) {
    memorySessions.delete(id);
    return null;
  }
  // Always clone — never hand out the Map-owned object to concurrent requests.
  return cloneSession(mem);
}

type SessionLoadSource = "redis" | "memory" | "mongo";

async function loadSession(
  id: string,
): Promise<{ session: ChatSession; source: SessionLoadSource } | null> {
  const fromRedis = await loadSessionFromRedis(id);
  if (fromRedis) return { session: fromRedis, source: "redis" };

  const fromMemory = await loadSessionFromMemory(id);
  if (fromMemory) return { session: fromMemory, source: "memory" };

  // Repair path: Redis/memory miss but Mongo still has the conversation.
  const fromMongo = await hydrateSessionFromMongo(id);
  if (!fromMongo) return null;

  const repaired = normalizeSession(fromMongo);
  logger.info("chat/session", "hydrated session from Mongo", {
    session: shortSessionId(id),
    messages: repaired.messages.length,
    hasProducts: Boolean(repaired.lastShownProducts?.length),
  });
  // Warm the hot store so subsequent turns hit Redis/memory.
  await persistSession(repaired, { allowCreate: true });
  return { session: repaired, source: "mongo" };
}

async function persistSession(
  session: ChatSession,
  options?: { allowCreate?: boolean },
): Promise<void> {
  const expectedVersion = asNonNegativeInt(session.version);
  session.updatedAt = Date.now();
  session.messages = trimHistory(session.messages);
  session.version = expectedVersion + 1;

  const payload = JSON.stringify(session);
  const redis = await getRedis();
  if (redis) {
    try {
      const result = await redis.eval(
        SESSION_CAS_LUA,
        1,
        sessionRedisKey(session.id),
        payload,
        String(expectedVersion),
        String(SESSION_TTL_SECONDS),
      );
      if (result === 0 || result === "0") {
        session.version = expectedVersion;
        throw new SessionConflictError();
      }
      // Keep memory mirror in sync for same-process fast path.
      memorySessions.set(session.id, cloneSession(session));
      return;
    } catch (err) {
      if (err instanceof SessionConflictError) throw err;
      logger.warn("chat/session", "Redis persist failed — using memory", {
        session: shortSessionId(session.id),
        error: err instanceof Error ? err.message : String(err),
      });
      // fall through to memory
    }
  }

  const mem = memorySessions.get(session.id);
  if (
    mem &&
    !options?.allowCreate &&
    asNonNegativeInt(mem.version) !== expectedVersion
  ) {
    session.version = expectedVersion;
    throw new SessionConflictError();
  }
  memorySessions.set(session.id, cloneSession(session));
}

async function deleteSession(id: string): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.del(sessionRedisKey(id));
      await redis.del(sessionLockKey(id));
    } catch {
      // ignore — best-effort cleanup
    }
  }
  memorySessions.delete(id);
  memoryLocks.delete(id);
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

export type GetOrCreateSessionResult = {
  session: ChatSession;
  isNew: boolean;
  /** Prior cookie session id when a new conversation was forced. */
  previousSessionId?: string;
  /** True when live store missed and Mongo repaired the session. */
  resumedFromMongo?: boolean;
};

/** Create or load a session from cookie value. */
export async function getOrCreateSession(
  cookieValue: string | undefined,
  options?: { forceNew?: boolean },
): Promise<GetOrCreateSessionResult> {
  if (options?.forceNew) {
    if (cookieValue) await deleteSession(cookieValue);
    const session = emptySession(randomUUID());
    await persistSession(session, { allowCreate: true });
    return {
      session,
      isNew: true,
      previousSessionId: cookieValue || undefined,
    };
  }

  if (cookieValue) {
    const existing = await loadSession(cookieValue);
    if (existing) {
      return {
        session: existing.session,
        isNew: false,
        resumedFromMongo: existing.source === "mongo",
      };
    }
  }

  const session = emptySession(randomUUID());
  await persistSession(session, { allowCreate: true });
  return { session, isNew: true };
}

/**
 * Acquire a short-lived per-session lock so overlapping turns cannot clobber
 * product memory / history. Returns false when another request holds the lock.
 */
export async function acquireSessionLock(
  sessionId: string,
  token: string,
): Promise<boolean> {
  const redis = await getRedis();
  if (redis) {
    try {
      const ok = await redis.set(
        sessionLockKey(sessionId),
        token,
        "EX",
        LOCK_TTL_SECONDS,
        "NX",
      );
      return ok === "OK";
    } catch (err) {
      logger.warn("chat/session", "Redis lock acquire failed — using memory", {
        session: shortSessionId(sessionId),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const now = Date.now();
  const existing = memoryLocks.get(sessionId);
  if (existing && existing.expiresAt > now && existing.token !== token) {
    return false;
  }
  memoryLocks.set(sessionId, {
    token,
    expiresAt: now + LOCK_TTL_SECONDS * 1000,
  });
  return true;
}

export async function releaseSessionLock(
  sessionId: string,
  token: string,
): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.eval(LOCK_RELEASE_LUA, 1, sessionLockKey(sessionId), token);
    } catch {
      // best-effort
    }
  }
  const existing = memoryLocks.get(sessionId);
  if (existing?.token === token) memoryLocks.delete(sessionId);
}

export async function saveSession(session: ChatSession): Promise<void> {
  const pendingMongo = takePendingMongoMessages(session);
  await persistSession(session);
  const ok = await persistChatToMongo(session, pendingMongo);
  if (!ok && pendingMongo.length > 0) {
    // Keep pending on this in-flight object for a rare same-request retry;
    // durable context fields were already attempted — next turn re-syncs state.
    for (const message of pendingMongo) {
      queueMongoMessage(session, message);
    }
  }
}

export function appendUserMessage(session: ChatSession, content: string): void {
  const message: ChatMessagePayload = {
    role: "user",
    content: content.slice(0, MAX_MESSAGE_CHARS),
  };
  queueMongoMessage(session, message);
  session.messages.push(message);
  session.messages = trimHistory(session.messages);
}

export function appendAssistantMessage(
  session: ChatSession,
  content: string,
): void {
  const message: ChatMessagePayload = {
    role: "assistant",
    content: content.slice(0, MAX_MESSAGE_CHARS),
  };
  queueMongoMessage(session, message);
  session.messages.push(message);
  session.messages = trimHistory(session.messages);
}

export function setConversationState(
  session: ChatSession,
  state: ConversationState,
  pendingOrderNumber: string | null = null,
): void {
  session.state = state;
  session.pendingOrderNumber =
    state === "awaiting_order_email" ? pendingOrderNumber : null;
}

/** Set the latest turn intent without clearing conversation state. */
export function setSessionIntent(session: ChatSession, intent: string): void {
  const trimmed = intent.trim();
  if (trimmed) session.intent = trimmed;
}

/** Accumulate OpenAI usage onto the session totals. */
export function addTokenUsage(
  session: ChatSession,
  usage: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
  },
): void {
  const prompt = asNonNegativeInt(usage.prompt_tokens);
  const completion = asNonNegativeInt(usage.completion_tokens);
  const total = asNonNegativeInt(usage.total_tokens) || prompt + completion;
  session.promptTokens = asNonNegativeInt(session.promptTokens) + prompt;
  session.completionTokens =
    asNonNegativeInt(session.completionTokens) + completion;
  session.totalTokens = asNonNegativeInt(session.totalTokens) + total;
}

export function resetConversationState(session: ChatSession): void {
  session.state = "idle";
  session.pendingOrderNumber = null;
}

export function setPendingCategory(
  session: ChatSession,
  category: string | null,
): void {
  session.pendingCategory = category?.trim() ? category.trim() : null;
}

/** Remember (or clear) the products most recently shown to the customer. */
export function setLastShownProducts(
  session: ChatSession,
  products: ShownProduct[] | null,
): void {
  session.lastShownProducts =
    products && products.length > 0 ? products : null;
}

/** Remember (or clear) the last catalog search query for follow-up merge. */
export function setLastSearchQuery(
  session: ChatSession,
  query: string | null,
): void {
  session.lastSearchQuery = query?.trim() ? query.trim() : null;
}

/** Freeze or clear the full catalog conversation context. */
export function setCatalogContext(
  session: ChatSession,
  context: ConversationCatalogContext | null,
): void {
  session.catalogContext = context;
}

/** Cookie attributes for the opaque session id. */
export function sessionCookieOptions(maxAgeSeconds = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Dev helper — fingerprint without logging raw secrets. */
export function shortSessionId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 8);
}

export function newRequestId(): string {
  return randomBytes(8).toString("hex");
}

export { MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS, SESSION_TTL_SECONDS };
