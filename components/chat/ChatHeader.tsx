/** Chat panel header: brand, online status, and the "New chat" action. */

import { STORE_NAME } from "@/components/chat/constants";
import { ChatBubbleIcon } from "@/components/chat/icons";

interface ChatHeaderProps {
  isTyping: boolean;
  onNewChat: () => void;
}

export default function ChatHeader({ isTyping, onNewChat }: ChatHeaderProps) {
  return (
    <div className="flex items-center gap-3 bg-indigo-600 px-4 py-3.5 text-white">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15">
        <ChatBubbleIcon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{STORE_NAME} Assistant</p>
        <p className="flex items-center gap-1.5 text-xs text-indigo-100">
          <span
            className="h-1.5 w-1.5 rounded-full bg-emerald-400"
            aria-hidden="true"
          />
          Online — we typically reply instantly
        </p>
      </div>
      <button
        type="button"
        onClick={onNewChat}
        disabled={isTyping}
        className="shrink-0 rounded-full border border-white/30 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
      >
        New chat
      </button>
    </div>
  );
}
