export type ChatRole = "user" | "assistant";

export interface ChatMessagePayload {
  role: ChatRole;
  content: string;
}

export interface ChatRequestBody {
  messages: ChatMessagePayload[];
}

export interface ChatSuccessResponse {
  reply: string;
}

export interface ChatErrorResponse {
  error: string;
}
