/** Shared types for the chat widget UI. */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** When true, render the quick-option menu under this assistant message. */
  showMenu?: boolean;
}

export interface ChatOption {
  id: string;
  label: string;
  enabled: boolean;
}
