"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import MessageContent from "@/components/chat/MessageContent";
import { stripAssistantMedia } from "@/lib/sanitize";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** When true, render the quick-option menu under this assistant message. */
  showMenu?: boolean;
}

interface ChatOption {
  id: string;
  label: string;
  enabled: boolean;
}

const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "Our Store";
const STORAGE_KEY = "chat-widget-history-v2";
const MAX_INPUT_CHARS = 2000;

const WELCOME_MESSAGE = `Welcome to **${STORE_NAME}**. I'm your shopping assistant.\n\nHow can I help you today? Choose an option below, or type your question.`;

const MENU_MESSAGE = `Here's the **main menu**. Choose an option below, or type your question.`;

const OPTIONS: ChatOption[] = [
  { id: "track-order", label: "Track Your Order", enabled: false },
  { id: "product-info", label: "Product Information", enabled: true },
  { id: "place-order", label: "Place an Order", enabled: false },
  { id: "refund-return", label: "Refunds & Returns", enabled: false },
  { id: "damaged-product", label: "Report a Damaged Product", enabled: false },
];

const UNAVAILABLE_REPLY =
  "This service is currently unavailable. I can help with product information or order tracking in the meantime.";

const PRODUCT_INFO_REPLY =
  "Certainly. Which product would you like details on? You can ask about price, sizes, colours, or availability.";

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `msg-${Date.now()}-${idCounter}`;
}

function isMenuCommand(text: string): boolean {
  return /^(m|menu|main\s*menu)$/i.test(text.trim());
}

function loadStoredMessages(): ChatMessage[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ChatMessage =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as ChatMessage).id === "string" &&
        ((m as ChatMessage).role === "user" ||
          (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).content === "string"
    );
  } catch {
    return [];
  }
}

function OptionButtons({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (option: ChatOption) => void;
}) {
  return (
    <div className="mt-3 flex flex-col items-start gap-2" role="group" aria-label="Quick options">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onSelect(option)}
          disabled={disabled || !option.enabled}
          aria-disabled={!option.enabled || disabled}
          className={
            option.enabled
              ? "rounded-full border border-indigo-600 bg-white px-3.5 py-1.5 text-sm font-medium text-indigo-600 transition hover:bg-indigo-600 hover:text-white disabled:opacity-50"
              : "rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-500 disabled:opacity-50"
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
  );
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** First API message after a fresh UI / "New chat" rotates the server session. */
  const startNewSessionRef = useRef(true);
  const panelId = "chat-widget-panel";

  useEffect(() => {
    const stored = loadStoredMessages();
    startTransition(() => {
      if (stored.length > 0) {
        setMessages(stored);
        // Only resume the cookie session if this tab already had a real conversation.
        startNewSessionRef.current = !stored.some((m) => m.role === "user");
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // storage full or unavailable
    }
  }, [messages, hydrated]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        launcherRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function toggleOpen() {
    if (!isOpen && messages.length === 0) {
      setMessages([
        {
          id: nextId(),
          role: "assistant",
          content: WELCOME_MESSAGE,
          showMenu: true,
        },
      ]);
    }
    setIsOpen((open) => {
      if (open) {
        queueMicrotask(() => launcherRef.current?.focus());
      }
      return !open;
    });
  }

  function startNewChat() {
    abortRef.current?.abort();
    setIsTyping(false);
    startNewSessionRef.current = true;
    setMessages([
      {
        id: nextId(),
        role: "assistant",
        content: WELCOME_MESSAGE,
        showMenu: true,
      },
    ]);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    inputRef.current?.focus();
  }

  function pushAssistant(content: string, showMenu = false) {
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "assistant", content, showMenu },
    ]);
  }

  function openMainMenu() {
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: "M" },
      {
        id: nextId(),
        role: "assistant",
        content: MENU_MESSAGE,
        showMenu: true,
      },
    ]);
    inputRef.current?.focus();
  }

  function handleOptionClick(option: ChatOption) {
    if (isTyping) return;
    if (!option.enabled) {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", content: option.label },
      ]);
      pushAssistant(UNAVAILABLE_REPLY);
      return;
    }
    if (option.id === "product-info") {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", content: option.label },
      ]);
      pushAssistant(PRODUCT_INFO_REPLY);
      inputRef.current?.focus();
      return;
    }
    // Track order goes through the API so server session state is set.
    void sendMessage(option.label);
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim().slice(0, MAX_INPUT_CHARS);
    if (!trimmed || isTyping) return;

    if (isMenuCommand(trimmed)) {
      setInput("");
      openMainMenu();
      return;
    }

    const userMessage: ChatMessage = {
      id: nextId(),
      role: "user",
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    let assistantId: string | null = null;

    const upsertAssistant = (content: string) => {
      if (!assistantId) {
        assistantId = nextId();
        setMessages((prev) => [
          ...prev,
          { id: assistantId!, role: "assistant", content },
        ]);
        return;
      }
      const id = assistantId;
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content } : m))
      );
    };

    const newSession = startNewSessionRef.current;
    startNewSessionRef.current = false;

    try {
      const res = await fetch("/api/chat?stream=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        credentials: "same-origin",
        signal: ac.signal,
        body: JSON.stringify({ message: trimmed, stream: true, newSession }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        upsertAssistant(
          data?.error ??
            "Something went wrong on our side. Please try again in a moment."
        );
        return;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream") || !res.body) {
        const data = (await res.json().catch(() => null)) as {
          reply?: string;
          error?: string;
        } | null;
        upsertAssistant(
          stripAssistantMedia(
            data?.reply ||
              data?.error ||
              "I didn't catch that. Could you rephrase your question?"
          )
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assembled = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string;
              text?: string;
              reply?: string;
              error?: string;
            };
            if (event.type === "delta" && event.text) {
              assembled += event.text;
              upsertAssistant(stripAssistantMedia(assembled));
            } else if (event.type === "done" && event.reply) {
              assembled = event.reply;
              upsertAssistant(stripAssistantMedia(assembled));
            } else if (event.type === "error") {
              upsertAssistant(
                event.error ?? "Something went wrong. Please try again."
              );
            }
          } catch {
            // ignore malformed SSE chunks
          }
        }
      }

      if (!assembled.trim()) {
        upsertAssistant(
          "I didn't catch that. Could you rephrase your question?"
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      upsertAssistant(
        "I couldn't reach the assistant right now. Please try again shortly."
      );
    } finally {
      if (abortRef.current === ac) {
        setIsTyping(false);
      }
    }
  }

  const showMenuHint = messages.filter((m) => m.role === "user").length >= 1;
  const latestAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return messages[i]!.id;
    }
    return null;
  })();

  // Only the latest menu message should show interactive options.
  const latestMenuId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant" && messages[i]?.showMenu) {
        return messages[i]!.id;
      }
    }
    return null;
  })();

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        aria-label={isOpen ? "Close chat" : "Open chat"}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={toggleOpen}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 transition hover:scale-105 hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        {isOpen ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-6 w-6"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-6 w-6"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 10.5h8m-8 3.5h5m-9.5 6.5V6.8c0-1 .8-1.8 1.8-1.8h13.4c1 0 1.8.8 1.8 1.8v9.4c0 1-.8 1.8-1.8 1.8H7.5l-4 2.5z"
            />
          </svg>
        )}
      </button>

      {isOpen && (
        <div
          id={panelId}
          role="dialog"
          aria-modal="true"
          aria-label={`${STORE_NAME} Assistant`}
          className="fixed bottom-24 right-5 z-50 flex h-[600px] max-h-[calc(100vh-7rem)] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        >
          <div className="flex items-center gap-3 bg-indigo-600 px-4 py-3.5 text-white">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-5 w-5"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 10.5h8m-8 3.5h5m-9.5 6.5V6.8c0-1 .8-1.8 1.8-1.8h13.4c1 0 1.8.8 1.8 1.8v9.4c0 1-.8 1.8-1.8 1.8H7.5l-4 2.5z"
                />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {STORE_NAME} Assistant
              </p>
              <p className="flex items-center gap-1.5 text-xs text-indigo-100">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                Online — we typically reply instantly
              </p>
            </div>
            <button
              type="button"
              onClick={startNewChat}
              disabled={isTyping}
              className="shrink-0 rounded-full border border-white/30 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
            >
              New chat
            </button>
          </div>

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
                      <MessageContent content={message.content} />
                    ) : (
                      message.content
                    )}
                  </div>

                  {message.role === "assistant" &&
                    message.showMenu &&
                    message.id === latestMenuId && (
                      <OptionButtons
                        disabled={isTyping}
                        onSelect={handleOptionClick}
                      />
                    )}

                  {isLatestAssistant && !message.showMenu && showMenuHint && (
                    <p className="mt-1.5 px-1 text-left text-[11px] text-slate-400">
                      Reply with{" "}
                      <span className="font-semibold text-slate-500">M</span>{" "}
                      for the main menu
                    </p>
                  )}
                </div>
              );
            })}

            {isTyping && (
              <div
                className="mr-auto flex w-fit items-center gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 shadow-sm"
                aria-label="Assistant is typing"
              >
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage(input);
            }}
            className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-3"
          >
            <label htmlFor="chat-widget-input" className="sr-only">
              Message
            </label>
            <input
              id="chat-widget-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about our products… or M for menu"
              disabled={isTyping}
              maxLength={MAX_INPUT_CHARS}
              className="flex-1 rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isTyping || !input.trim()}
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-4 w-4"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 12h13m0 0l-5-5m5 5l-5 5"
                />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
