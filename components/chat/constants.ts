/** Static configuration and canned copy for the chat widget. */

import type { ChatOption } from "@/components/chat/types";

export const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "Our Store";
export const STORAGE_KEY = "chat-widget-history-v2";
export const MAX_INPUT_CHARS = 2000;

export const WELCOME_MESSAGE = `Welcome to **${STORE_NAME}**. I'm your shopping assistant.\n\nHow can I help you today? Choose an option below, or type your question.`;

export const MENU_MESSAGE = `Here's the **main menu**. Choose an option below, or type your question.`;

export const OPTIONS: ChatOption[] = [
  { id: "track-order", label: "Track Your Order", enabled: false },
  { id: "product-info", label: "Product Information", enabled: true },
  { id: "place-order", label: "Place an Order", enabled: false },
  { id: "refund-return", label: "Refunds & Returns", enabled: false },
  { id: "damaged-product", label: "Report a Damaged Product", enabled: false },
];

export const UNAVAILABLE_REPLY =
  "This service is currently unavailable. I can help with product information or order tracking in the meantime.";

export const PRODUCT_INFO_REPLY =
  "Certainly. Which product would you like details on? You can ask about price, sizes, colours, or availability.";
