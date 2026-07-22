/** Floating launcher button that opens/closes the chat panel. Presentational. */

import type { Ref } from "react";
import { ChatBubbleIcon, CloseIcon } from "@/components/chat/icons";

interface ChatLauncherProps {
  isOpen: boolean;
  panelId: string;
  onToggle: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}

export default function ChatLauncher({
  isOpen,
  panelId,
  onToggle,
  buttonRef,
}: ChatLauncherProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={isOpen ? "Close chat" : "Open chat"}
      aria-expanded={isOpen}
      aria-controls={panelId}
      onClick={onToggle}
      className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 transition hover:scale-105 hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      {isOpen ? <CloseIcon /> : <ChatBubbleIcon />}
    </button>
  );
}
