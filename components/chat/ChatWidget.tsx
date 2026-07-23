"use client";

import { useEffect, useRef, useState } from "react";
import ChatComposer from "@/components/chat/ChatComposer";
import ChatHeader from "@/components/chat/ChatHeader";
import ChatLauncher from "@/components/chat/ChatLauncher";
import MessageList from "@/components/chat/MessageList";
import {
  MAX_INPUT_CHARS,
  MENU_MESSAGE,
  PRODUCT_INFO_REPLY,
  STORE_NAME,
  UNAVAILABLE_REPLY,
  WELCOME_MESSAGE,
} from "@/components/chat/constants";
import { useChatHistory } from "@/components/chat/hooks/useChatHistory";
import { useChatStream } from "@/components/chat/hooks/useChatStream";
import type { ChatMessage, ChatOption } from "@/components/chat/types";
import { isMenuCommand, nextId } from "@/components/chat/utils";

const PANEL_ID = "chat-widget-panel";

function welcomeMessage(): ChatMessage {
  return {
    id: nextId(),
    role: "assistant",
    content: WELCOME_MESSAGE,
    showMenu: true,
  };
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, setMessages, startNewSessionRef, resetMessages } =
    useChatHistory();
  const { isTyping, send, stop } = useChatStream();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

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

  function toggleOpen() {
    if (!isOpen && messages.length === 0) {
      setMessages([welcomeMessage()]);
    }
    setIsOpen((open) => {
      if (open) {
        queueMicrotask(() => launcherRef.current?.focus());
      }
      return !open;
    });
  }

  function startNewChat() {
    stop();
    resetMessages([welcomeMessage()]);
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

    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: trimmed },
    ]);
    setInput("");

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
        prev.map((m) => (m.id === id ? { ...m, content } : m)),
      );
    };

    const newSession = startNewSessionRef.current;
    startNewSessionRef.current = false;

    await send(
      { message: trimmed, newSession },
      { onAssistantContent: upsertAssistant },
    );
  }

  return (
    <>
      <ChatLauncher
        isOpen={isOpen}
        panelId={PANEL_ID}
        onToggle={toggleOpen}
        buttonRef={launcherRef}
      />

      {isOpen && (
        <div
          id={PANEL_ID}
          role="dialog"
          aria-modal="true"
          aria-label={`${STORE_NAME} Assistant`}
          className="fixed bottom-24 right-5 z-50 flex h-[600px] max-h-[calc(100vh-7rem)] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        >
          <ChatHeader isTyping={isTyping} onNewChat={startNewChat} />
          <MessageList
            messages={messages}
            isTyping={isTyping}
            onOptionSelect={handleOptionClick}
            scrollRef={scrollRef}
          />
          <ChatComposer
            value={input}
            isTyping={isTyping}
            inputRef={inputRef}
            onChange={setInput}
            onSubmit={() => void sendMessage(input)}
          />
        </div>
      )}
    </>
  );
}
