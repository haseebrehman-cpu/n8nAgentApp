/**
 * Scrollable conversation view: renders messages, the quick-option menu under
 * the latest menu message, the "reply M for menu" hint, and the typing
 * indicator. Owns the small display-only derivations about which message
 * should show interactive affordances.
 */

import type { RefObject } from "react";
import MessageContent from "@/components/chat/MessageContent";
import OptionButtons from "@/components/chat/OptionButtons";
import SizeChartAttachment from "@/components/chat/SizeChartAttachment";
import type { ChatMessage, ChatOption } from "@/components/chat/types";

interface MessageListProps {
  messages: ChatMessage[];
  isTyping: boolean;
  onOptionSelect: (option: ChatOption) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}

function TypingIndicator() {
  return (
    <div
      className="mr-auto flex w-fit items-center gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 shadow-sm"
      aria-label="Assistant is typing"
    >
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
    </div>
  );
}

function findLatestId(
  messages: ChatMessage[],
  predicate: (m: ChatMessage) => boolean,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && predicate(m)) return m.id;
  }
  return null;
}

export default function MessageList({
  messages,
  isTyping,
  onOptionSelect,
  scrollRef,
}: MessageListProps) {
  const showMenuHint = messages.filter((m) => m.role === "user").length >= 1;
  const latestAssistantId = findLatestId(
    messages,
    (m) => m.role === "assistant",
  );
  // Only the latest menu message should show interactive options.
  const latestMenuId = findLatestId(
    messages,
    (m) => m.role === "assistant" && Boolean(m.showMenu),
  );

  return (
    <div
      ref={scrollRef}
      className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4"
      aria-live="polite"
      aria-busy={isTyping}
    >
      {messages.map((message) => {
        const isLatestAssistant = message.id === latestAssistantId;

        return (
          <div key={message.id} className="w-full">
            <div
              className={
                message.role === "user"
                  ? "ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2.5 text-left text-sm leading-relaxed text-white"
                  : "mr-auto w-full max-w-[95%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 text-left shadow-sm"
              }
            >
              {message.role === "assistant" ? (
                <>
                  <MessageContent content={message.content} />
                  {message.attachments?.map((attachment, index) =>
                    attachment.kind === "size_chart" ? (
                      <SizeChartAttachment
                        key={`${message.id}-chart-${index}`}
                        attachment={attachment}
                      />
                    ) : null,
                  )}
                </>
              ) : (
                message.content
              )}
            </div>

            {message.role === "assistant" &&
              message.showMenu &&
              message.id === latestMenuId && (
                <OptionButtons disabled={isTyping} onSelect={onOptionSelect} />
              )}

            {isLatestAssistant && !message.showMenu && showMenuHint && (
              <p className="mt-1.5 px-1 text-left text-[11px] text-slate-400">
                Reply with{" "}
                <span className="font-semibold text-slate-500">M</span> for the
                main menu
              </p>
            )}
          </div>
        );
      })}

      {isTyping && <TypingIndicator />}
    </div>
  );
}
