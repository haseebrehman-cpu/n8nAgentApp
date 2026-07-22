/** Options for a single chat-agent turn. */

import type { ChatSession } from "@/lib/chat/session";
import type { ShopifyStoreRegion } from "@/services/shopify/credentials";

export interface RunChatAgentOptions {
  session: ChatSession;
  signal?: AbortSignal;
  region?: ShopifyStoreRegion;
  requestId?: string;
}
