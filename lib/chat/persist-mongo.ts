import Chat from "@/app/models/chatModel";
import type { ChatSession } from "@/lib/chat/session";
import { logger } from "@/lib/logger";
import dbConnect from "@/lib/mongo";

/**
 * Upsert the session transcript into MongoDB.
 * Soft-fails so Redis/memory session storage remains the source of truth for the live chat.
 */
export async function persistChatToMongo(session: ChatSession): Promise<void> {
  if (!process.env.MONGO_URI) return;

  try {
    await dbConnect();
    await Chat.findOneAndUpdate(
      { sessionId: session.id },
      {
        $set: {
          sessionId: session.id,
          messages: session.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          totalMessages: session.messages.length,
          isActive: true,
        },
      },
      { upsert: true, returnDocument: "after" }
    );
  } catch (error) {
    logger.error("chat/mongo", "failed to persist chat", {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
