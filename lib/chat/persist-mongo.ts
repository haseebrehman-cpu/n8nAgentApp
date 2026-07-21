import Chat from "@/app/models/chatModel";
import type { ChatSession } from "@/lib/chat/session";
import type { ChatMessagePayload } from "@/lib/types";
import { logger } from "@/lib/logger";
import dbConnect from "@/lib/mongo";

/**
 * Append new turns to the Mongo transcript.
 * Soft-fails so Redis/memory session storage remains the source of truth for the live chat.
 * Live session history is capped; Mongo accumulates the full conversation via $push.
 */
export async function persistChatToMongo(
  session: ChatSession,
  newMessages: ChatMessagePayload[] = [],
): Promise<void> {
  if (!process.env.MONGO_URI) return;
  if (newMessages.length === 0) return;

  try {
    await dbConnect();
    const messages = newMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    await Chat.findOneAndUpdate(
      { sessionId: session.id },
      {
        $set: {
          sessionId: session.id,
          isActive: true,
          intent: session.intent ?? null,
          promptTokens: session.promptTokens ?? 0,
          completionTokens: session.completionTokens ?? 0,
          totalTokens: session.totalTokens ?? 0,
        },
        $push: {
          messages: { $each: messages },
        },
        $inc: {
          totalMessages: messages.length,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    logger.error("chat/mongo", "failed to persist chat", {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
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
