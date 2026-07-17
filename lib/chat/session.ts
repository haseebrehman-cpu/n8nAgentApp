/**
 * Server-side chat session: history + conversation state machine.
 *
 * Prefer Redis when available; fall back to signed in-memory Map for local/dev.
 * Clients never author assistant turns — only the latest user message is accepted.
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import { getRedis, redisKey } from "@/lib/redis";
import type { ChatMessagePayload } from "@/lib/types";

export type ConversationState =
  | "idle"
  | "awaiting_order_number"
  | "awaiting_order_email";

export interface ChatSession {
  id: string;
  messages: ChatMessagePayload[];
  state: ConversationState;
  /** Pending order number while awaiting email verification. */
  pendingOrderNumber: string | null;
  /** Last category/productType discussed (for follow-ups like "list the ones in stock"). */
  pendingCategory: string | null;
  updatedAt: number;
}

const SESSION_TTL_SECONDS = 60 * 60 * 4; // 4 hours
const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 2_000;
const COOKIE_NAME = "chat_session";

const memorySessions = new Map<string, ChatSession>();

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

function emptySession(id: string): ChatSession {
  return {
    id,
    messages: [],
    state: "idle",
    pendingOrderNumber: null,
    pendingCategory: null,
    updatedAt: Date.now(),
  };
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
        updatedAt: parsed.updatedAt ?? Date.now(),
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
        SESSION_TTL_SECONDS
      );
      return;
    } catch {
      // fall through to memory
    }
  }

  memorySessions.set(session.id, session);
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

/** Create or load a session from cookie value. */
export async function getOrCreateSession(
  cookieValue: string | undefined
): Promise<{ session: ChatSession; isNew: boolean }> {
  if (cookieValue) {
    const existing = await loadSession(cookieValue);
    if (existing) return { session: existing, isNew: false };
  }

  const id = randomUUID();
  const session = emptySession(id);
  await persistSession(session);
  return { session, isNew: true };
}

export async function saveSession(session: ChatSession): Promise<void> {
  await persistSession(session);
}

export function appendUserMessage(
  session: ChatSession,
  content: string
): void {
  session.messages.push({
    role: "user",
    content: content.slice(0, MAX_MESSAGE_CHARS),
  });
  session.messages = trimHistory(session.messages);
}

export function appendAssistantMessage(
  session: ChatSession,
  content: string
): void {
  session.messages.push({
    role: "assistant",
    content: content.slice(0, MAX_MESSAGE_CHARS),
  });
  session.messages = trimHistory(session.messages);
}

export function setConversationState(
  session: ChatSession,
  state: ConversationState,
  pendingOrderNumber: string | null = null
): void {
  session.state = state;
  session.pendingOrderNumber =
    state === "awaiting_order_email" ? pendingOrderNumber : null;
}

export function resetConversationState(session: ChatSession): void {
  session.state = "idle";
  session.pendingOrderNumber = null;
}

export function setPendingCategory(
  session: ChatSession,
  category: string | null
): void {
  session.pendingCategory = category?.trim() ? category.trim() : null;
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
