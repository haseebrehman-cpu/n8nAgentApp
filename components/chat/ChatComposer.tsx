/** Message input row: text field + send button. Presentational + controlled. */

import type { Ref } from "react";
import { MAX_INPUT_CHARS } from "@/components/chat/constants";
import { SendIcon } from "@/components/chat/icons";

interface ChatComposerProps {
  value: string;
  isTyping: boolean;
  inputRef: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export default function ChatComposer({
  value,
  isTyping,
  inputRef,
  onChange,
  onSubmit,
}: ChatComposerProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-3"
    >
      <label htmlFor="chat-widget-input" className="sr-only">
        Message
      </label>
      <input
        id="chat-widget-input"
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ask about our products… or M for menu"
        disabled={isTyping}
        maxLength={MAX_INPUT_CHARS}
        className="flex-1 rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={isTyping || !value.trim()}
        aria-label="Send message"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"
      >
        <SendIcon />
      </button>
    </form>
  );
}
