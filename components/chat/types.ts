/** Shared types for the chat widget UI. */

import type { ChatAttachment } from "@/lib/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** When true, render the quick-option menu under this assistant message. */
  showMenu?: boolean;
  /** Server-verified attachments (e.g. size charts) — never model-authored. */
  attachments?: ChatAttachment[];
}

export interface ChatOption {
  id: string;
  label: string;
  enabled: boolean;
}

export type { ChatAttachment };
