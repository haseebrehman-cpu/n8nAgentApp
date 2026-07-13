"use client";

import { useEffect, useRef, useState } from "react";
import MessageContent, { sanitizeReply } from "@/components/MessageContent";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ChatOption {
  id: string;
  label: string;
  enabled: boolean;
}

const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "Our Store";

const WELCOME_MESSAGE = `Welcome to **${STORE_NAME}**. I'm your shopping assistant.\n\nHow can I help you today? Choose an option below, or type your question.`;

const OPTIONS: ChatOption[] = [
  { id: "track-order", label: "Track Your Order", enabled: false },
  { id: "product-info", label: "Product Information", enabled: true },
  { id: "place-order", label: "Place an Order", enabled: false },
  { id: "refund-return", label: "Refunds & Returns", enabled: false },
  { id: "damaged-product", label: "Report a Damaged Product", enabled: false },
];

const UNAVAILABLE_REPLY =
  "This service is currently unavailable. I can help with product information in the meantime.";

const PRODUCT_INFO_REPLY =
  "Certainly. Which product would you like details on? You can ask about price, sizes, colours, or availability.";

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `msg-${Date.now()}-${idCounter}`;
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function toggleOpen() {
    if (!isOpen && messages.length === 0) {
      setMessages([{ id: nextId(), role: "assistant", content: WELCOME_MESSAGE }]);
    }
    setIsOpen(!isOpen);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  function pushAssistant(content: string) {
    setMessages((prev) => [...prev, { id: nextId(), role: "assistant", content }]);
  }

  function handleOptionClick(option: ChatOption) {
    if (isTyping) return;
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: option.label },
    ]);
    if (!option.enabled) {
      pushAssistant(UNAVAILABLE_REPLY);
      return;
    }
    pushAssistant(PRODUCT_INFO_REPLY);
    inputRef.current?.focus();
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;

    const userMessage: ChatMessage = { id: nextId(), role: "user", content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        pushAssistant(
          data?.error ??
            "Sorry, something went wrong on our side. Please try again in a moment."
        );
        return;
      }
      pushAssistant(
        sanitizeReply(data.reply || "I didn't catch that. Could you rephrase your question?")
      );
    } catch {
      pushAssistant(
        "I couldn't reach the assistant right now. Please try again shortly."
      );
    } finally {
      setIsTyping(false);
    }
  }

  return (
    <>
      {/* Launcher button */}
      <button
        type="button"
        aria-label={isOpen ? "Close chat" : "Open chat"}
        onClick={toggleOpen}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 transition hover:scale-105 hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        {isOpen ? (
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="2">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 10.5h8m-8 3.5h5m-9.5 6.5V6.8c0-1 .8-1.8 1.8-1.8h13.4c1 0 1.8.8 1.8 1.8v9.4c0 1-.8 1.8-1.8 1.8H7.5l-4 2.5z"
            />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[600px] max-h-[calc(100vh-7rem)] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 bg-indigo-600 px-4 py-3.5 text-white">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 10.5h8m-8 3.5h5m-9.5 6.5V6.8c0-1 .8-1.8 1.8-1.8h13.4c1 0 1.8.8 1.8 1.8v9.4c0 1-.8 1.8-1.8 1.8H7.5l-4 2.5z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{STORE_NAME} Assistant</p>
              <p className="flex items-center gap-1.5 text-xs text-indigo-100">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Online — we typically reply instantly
              </p>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
            {messages.map((message, index) => (
              <div key={message.id} className="w-full">
                <div
                  className={
                    message.role === "user"
                      ? "ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2.5 text-left text-sm leading-relaxed text-white"
                      : "mr-auto w-full max-w-[95%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 text-left shadow-sm"
                  }
                >
                  {message.role === "assistant" ? (
                    <MessageContent content={message.content} />
                  ) : (
                    message.content
                  )}
                </div>

                {/* Option buttons under the welcome message */}
                {index === 0 && message.role === "assistant" && (
                  <div className="mt-3 flex flex-col items-start gap-2">
                    {OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => handleOptionClick(option)}
                        disabled={isTyping}
                        className={
                          option.enabled
                            ? "rounded-full border border-indigo-600 bg-white px-3.5 py-1.5 text-sm font-medium text-indigo-600 transition hover:bg-indigo-600 hover:text-white disabled:opacity-50"
                            : "rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
                        }
                      >
                        {option.label}
                        {!option.enabled && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-400">
                            soon
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isTyping && (
              <div className="mr-auto flex w-fit items-center gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
            className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-3"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about our products..."
              disabled={isTyping}
              className="flex-1 rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isTyping || !input.trim()}
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h13m0 0l-5-5m5 5l-5 5" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
