/**
 * Session-scoped persistence for the chat transcript. Isolates all
 * sessionStorage access (and its failure modes) from the React components.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("window", {
  sessionStorage: {
    store: {} as Record<string, string>,
    getItem(key: string) {
      return this.store[key] ?? null;
    },
    setItem(key: string, value: string) {
      this.store[key] = value;
    },
    removeItem(key: string) {
      delete this.store[key];
    },
  },
});

import {
  clearStoredMessages,
  loadStoredMessages,
  saveStoredMessages,
} from "@/components/chat/chatStorage";
import { STORAGE_KEY } from "@/components/chat/constants";

describe("chatStorage attachments", () => {
  const prevHost = process.env.NEXT_PUBLIC_STOREFRONT_HOST;

  afterEach(() => {
    clearStoredMessages();
    if (prevHost === undefined) delete process.env.NEXT_PUBLIC_STOREFRONT_HOST;
    else process.env.NEXT_PUBLIC_STOREFRONT_HOST = prevHost;
  });

  it("round-trips allowlisted size-chart attachments", () => {
    process.env.NEXT_PUBLIC_STOREFRONT_HOST = "rdxsports.co.uk";
    saveStoredMessages([
      {
        id: "1",
        role: "assistant",
        content: "Here is the chart.",
        attachments: [
          {
            kind: "size_chart",
            productId: "gid://shopify/Product/1",
            productTitle: "AS2",
            url: "https://rdxsports.co.uk/cdn/shop/files/chart.webp",
            altText: "AS2 chart",
            width: 100,
            height: 80,
          },
        ],
      },
    ]);

    const loaded = loadStoredMessages();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.attachments).toHaveLength(1);
    expect(loaded[0]?.attachments?.[0]?.url).toContain("chart.webp");
  });

  it("drops malicious attachments on load", () => {
    process.env.NEXT_PUBLIC_STOREFRONT_HOST = "rdxsports.co.uk";
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "1",
          role: "assistant",
          content: "hi",
          attachments: [
            {
              kind: "size_chart",
              productId: "x",
              productTitle: "x",
              url: "https://evil.example/cdn/shop/files/x.webp",
              altText: "x",
              width: null,
              height: null,
            },
          ],
        },
      ]),
    );

    const loaded = loadStoredMessages();
    expect(loaded[0]?.attachments).toBeUndefined();
  });
});
