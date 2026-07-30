import Chat from "@/app/models/chatModel";
import {
  normalizeCatalogContext,
  type ConversationCatalogContext,
} from "@/lib/chat/context/conversation-context";
import {
  normalizeShownProducts,
  type ShownProduct,
} from "@/lib/chat/context/product-memory";
import type { ChatSession, ConversationState } from "@/lib/chat/session";
import type { ChatMessagePayload } from "@/lib/types";
import { logger } from "@/lib/logger";
import dbConnect from "@/lib/mongo";

const MONGO_WRITE_ATTEMPTS = 3;

export type HydratedChatSession = {
  id: string;
  messages: ChatMessagePayload[];
  intent: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  state: ConversationState;
  pendingOrderNumber: string | null;
  pendingCategory: string | null;
  lastShownProducts: ShownProduct[] | null;
  lastSearchQuery: string | null;
  catalogContext: ConversationCatalogContext | null;
  version: number;
  updatedAt: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function contextFieldsFromSession(session: ChatSession) {
  return {
    intent: session.intent ?? null,
    promptTokens: session.promptTokens ?? 0,
    completionTokens: session.completionTokens ?? 0,
    totalTokens: session.totalTokens ?? 0,
    state: session.state ?? "idle",
    pendingOrderNumber: session.pendingOrderNumber ?? null,
    pendingCategory: session.pendingCategory ?? null,
    lastSearchQuery: session.lastSearchQuery ?? null,
    lastShownProducts: session.lastShownProducts ?? undefined,
    catalogContext: session.catalogContext ?? undefined,
    version: session.version ?? 0,
    isActive: true,
  };
}

/**
 * Upsert live context + append new turns to the Mongo transcript.
 * Retries transient failures. Soft-fails so Redis remains the hot path.
 * Returns false only after all attempts fail (caller may re-queue).
 */
export async function persistChatToMongo(
  session: ChatSession,
  newMessages: ChatMessagePayload[] = [],
): Promise<boolean> {
  if (!process.env.MONGO_URI) return true;

  const messages = newMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const context = contextFieldsFromSession(session);

  for (let attempt = 1; attempt <= MONGO_WRITE_ATTEMPTS; attempt++) {
    try {
      await dbConnect();
      const update: Record<string, unknown> = {
        $set: {
          sessionId: session.id,
          ...context,
        },
      };
      if (messages.length > 0) {
        update.$push = { messages: { $each: messages } };
        update.$inc = { totalMessages: messages.length };
      }

      await Chat.findOneAndUpdate({ sessionId: session.id }, update, {
        upsert: true,
      });
      return true;
    } catch (error) {
      if (attempt < MONGO_WRITE_ATTEMPTS) {
        await sleep(40 * attempt);
        continue;
      }
      logger.error("chat/mongo", "failed to persist chat", {
        sessionId: session.id,
        attempts: MONGO_WRITE_ATTEMPTS,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
  return false;
}

/**
 * Rebuild a live session from Mongo when Redis/memory miss (TTL, restart, etc.).
 * Returns null when there is no durable transcript for this session id.
 */
export async function hydrateSessionFromMongo(
  sessionId: string,
): Promise<HydratedChatSession | null> {
  if (!process.env.MONGO_URI || !sessionId) return null;

  try {
    await dbConnect();
    const doc = await Chat.findOne({ sessionId, isActive: true })
      .select({
        sessionId: 1,
        messages: 1,
        intent: 1,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 1,
        state: 1,
        pendingOrderNumber: 1,
        pendingCategory: 1,
        lastSearchQuery: 1,
        lastShownProducts: 1,
        catalogContext: 1,
        version: 1,
        updatedAt: 1,
      })
      .lean();

    if (!doc || typeof doc !== "object") return null;

    const raw = doc as {
      sessionId?: string;
      messages?: Array<{ role?: unknown; content?: unknown }>;
      intent?: unknown;
      promptTokens?: unknown;
      completionTokens?: unknown;
      totalTokens?: unknown;
      state?: unknown;
      pendingOrderNumber?: unknown;
      pendingCategory?: unknown;
      lastSearchQuery?: unknown;
      lastShownProducts?: unknown;
      catalogContext?: unknown;
      version?: unknown;
      updatedAt?: Date | string | number;
    };

    const messages: ChatMessagePayload[] = [];
    if (Array.isArray(raw.messages)) {
      for (const m of raw.messages) {
        if (
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim()
        ) {
          messages.push({ role: m.role, content: m.content });
        }
      }
    }

    // Empty inactive-looking docs are not useful for resume.
    if (
      messages.length === 0 &&
      !normalizeShownProducts(raw.lastShownProducts) &&
      !raw.lastSearchQuery
    ) {
      return null;
    }

    const updatedAt =
      raw.updatedAt instanceof Date
        ? raw.updatedAt.getTime()
        : typeof raw.updatedAt === "number"
          ? raw.updatedAt
          : Date.now();

    return {
      id: sessionId,
      messages,
      intent: typeof raw.intent === "string" ? raw.intent : null,
      promptTokens: asNonNegativeInt(raw.promptTokens),
      completionTokens: asNonNegativeInt(raw.completionTokens),
      totalTokens: asNonNegativeInt(raw.totalTokens),
      state: asConversationState(raw.state),
      pendingOrderNumber:
        typeof raw.pendingOrderNumber === "string"
          ? raw.pendingOrderNumber
          : null,
      pendingCategory:
        typeof raw.pendingCategory === "string" ? raw.pendingCategory : null,
      lastShownProducts: normalizeShownProducts(raw.lastShownProducts),
      lastSearchQuery:
        typeof raw.lastSearchQuery === "string" && raw.lastSearchQuery.trim()
          ? raw.lastSearchQuery.trim()
          : null,
      catalogContext: normalizeCatalogContext(raw.catalogContext),
      version: asNonNegativeInt(raw.version),
      updatedAt,
    };
  } catch (error) {
    logger.error("chat/mongo", "failed to hydrate session", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Close out a prior conversation when the client starts a new session. */
export async function markChatInactive(sessionId: string): Promise<void> {
  if (!process.env.MONGO_URI || !sessionId) return;

  try {
    await dbConnect();
    await Chat.updateOne({ sessionId }, { $set: { isActive: false } });
  } catch (error) {
    logger.error("chat/mongo", "failed to mark chat inactive", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
