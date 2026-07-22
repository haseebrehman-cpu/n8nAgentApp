/**
 * Server-side chat session: history + conversation state machine.
 *
 * Prefer Redis when available; fall back to signed in-memory Map for local/dev.
 * Clients never author assistant turns — only the latest user message is accepted.
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import { persistChatToMongo } from "@/lib/chat/persist-mongo";
import { getRedis, redisKey } from "@/lib/redis";
import type { ShownProduct } from "@/lib/chat/context/product-memory";
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
  updatedAt: number;
}

const SESSION_TTL_SECONDS = 60 * 60 * 4; // 4 hours
/** Live agent/Redis context window — Mongo keeps the full transcript via appends. */
const MAX_HISTORY_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 2_000;
const COOKIE_NAME = "chat_session";

const memorySessions = new Map<string, ChatSession>();
/** Request-scoped messages to append to Mongo (not stored in Redis). */
const pendingMongoBySession = new WeakMap<ChatSession, ChatMessagePayload[]>();

function sessionRedisKey(id: string): string {
  return redisKey("chat", "session", id);
}

function trimHistory(messages: ChatMessagePayload[]): ChatMessagePayload[] {
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    role: m.role,
    content: m.content.slice(0, MAX_MESSAGE_CHARS),
  }));
  return trimmed;
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

async function loadSession(id: string): Promise<ChatSession | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      const raw = await redis.get(sessionRedisKey(id));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ChatSession;
      if (!parsed?.id || !Array.isArray(parsed.messages)) return null;
      return {
        id: parsed.id,
        messages: trimHistory(parsed.messages),
        state: parsed.state ?? "idle",
        pendingOrderNumber: parsed.pendingOrderNumber ?? null,
        pendingCategory: parsed.pendingCategory ?? null,
        lastShownProducts: Array.isArray(parsed.lastShownProducts)
          ? parsed.lastShownProducts
          : null,
        updatedAt: parsed.updatedAt ?? Date.now(),
        intent: parsed.intent ?? null,
        promptTokens: asNonNegativeInt(parsed.promptTokens),
        completionTokens: asNonNegativeInt(parsed.completionTokens),
        totalTokens: asNonNegativeInt(parsed.totalTokens),
      };
    } catch {
      return null;
    }
  }

  const mem = memorySessions.get(id);
  if (!mem) return null;
  if (Date.now() - mem.updatedAt > SESSION_TTL_SECONDS * 1000) {
    memorySessions.delete(id);
    return null;
  }
  return mem;
}

async function persistSession(session: ChatSession): Promise<void> {
  session.updatedAt = Date.now();
  session.messages = trimHistory(session.messages);

  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(
        sessionRedisKey(session.id),
        JSON.stringify(session),
        "EX",
        SESSION_TTL_SECONDS,
      );
      return;
    } catch {
      // fall through to memory
    }
  }

  memorySessions.set(session.id, session);
}

async function deleteSession(id: string): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.del(sessionRedisKey(id));
    } catch {
      // ignore — best-effort cleanup
    }
  }
  memorySessions.delete(id);
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

export type GetOrCreateSessionResult = {
  session: ChatSession;
  isNew: boolean;
  /** Prior cookie session id when a new conversation was forced. */
  previousSessionId?: string;
};

/** Create or load a session from cookie value. */
export async function getOrCreateSession(
  cookieValue: string | undefined,
  options?: { forceNew?: boolean },
): Promise<GetOrCreateSessionResult> {
  if (options?.forceNew) {
    if (cookieValue) await deleteSession(cookieValue);
    const session = emptySession(randomUUID());
    await persistSession(session);
    return {
      session,
      isNew: true,
      previousSessionId: cookieValue || undefined,
    };
  }

  if (cookieValue) {
    const existing = await loadSession(cookieValue);
    if (existing) return { session: existing, isNew: false };
  }

  const session = emptySession(randomUUID());
  await persistSession(session);
  return { session, isNew: true };
}

export async function saveSession(session: ChatSession): Promise<void> {
  const pendingMongo = takePendingMongoMessages(session);
  await persistSession(session);
  await persistChatToMongo(session, pendingMongo);
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

/** Cookie attributes for the session id. */
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

export { MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS };
