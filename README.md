# Shopify AI Chatbot (Next.js + n8n)

Production-ready AI customer support chatbot for a Shopify store.

- **Conversational AI lives inside Next.js** — the `/api/chat` route runs an OpenAI tool-calling agent that queries the Shopify Admin API for live product data.
- **n8n is reserved for automation workflows** — order tracking, refunds/returns, and complaint handling will be wired to n8n workflows later. Those menu options currently show "unavailable".

## Features

- Floating chat widget with a welcome message and quick-option buttons:
  - Track Your Order *(coming soon)*
  - **Product Information** *(live)*
  - Place an Order *(coming soon)*
  - Refunds & Returns *(coming soon)*
  - Report a Damaged Product *(coming soon)*
- Live product answers (prices, sizes, variants, stock) pulled from your Shopify catalog — the AI never invents product facts.
- **Market-aware pricing** — set `SHOPIFY_MARKET_COUNTRY` and the assistant quotes the exact prices customers see on your storefront.
- Strictly scoped: refuses off-topic questions and redirects to store topics.
- Production hardening: per-IP rate limiting, request validation, API timeouts, env validation with clear errors, and session-persistent chat history.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add credentials

Copy `.env.example` to `.env.local` and fill in:

| Variable | Required | Where to get it |
|----------|----------|----------------|
| `OPENAI_API_KEY` | Yes | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini` |
| `SHOPIFY_STORE_DOMAIN` | Yes | Your `*.myshopify.com` domain, without `https://` |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Yes | Shopify admin → Settings → Apps and sales channels → **Develop apps** → create an app → enable the `read_products` Admin API scope → install → reveal the `shpat_...` token |
| `SHOPIFY_MARKET_COUNTRY` | No | 2-letter country code of your storefront market (e.g. `DE`). Ensures quoted prices match the storefront exactly |
| `NEXT_PUBLIC_STORE_NAME` | No | Your store's display name in the widget |

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click the chat bubble.

## Architecture

```
app/
  api/chat/route.ts    # HTTP layer: validation, rate limiting, error mapping
  page.tsx             # Demo page hosting the widget
components/
  ChatWidget.tsx       # Floating chat widget (welcome, options, history persistence)
  MessageContent.tsx   # Markdown renderer for assistant replies
lib/
  chat-agent.ts        # OpenAI tool-calling agent loop
  shopify.ts           # Shopify Admin GraphQL client (market-aware pricing, timeouts)
  system-prompt.ts     # Assistant rules: scope, tool usage, formatting
  config.ts            # Env validation (fails fast with clear messages)
  rate-limit.ts        # In-memory sliding-window rate limiter (per IP)
  sanitize.ts          # Strips image markdown / CDN URLs from replies
  types.ts             # Shared request/response types
```

### Request flow

1. Widget POSTs the conversation to `/api/chat`.
2. The route validates the payload and applies a per-IP rate limit (20 req/min).
3. `runChatAgent` runs the OpenAI loop; when the model calls `search_products`, the Shopify client fetches live catalog data with market-contextual pricing.
4. The reply is sanitized (no image markdown or CDN URLs) and rendered as markdown in the widget.

### Scaling notes

- The rate limiter is in-memory (fine for one instance). For multi-instance deployments, swap `lib/rate-limit.ts` for a Redis/Upstash-backed implementation — the `checkRateLimit` signature stays the same.
- Chat history lives in the browser (`sessionStorage`) and is replayed with each request, so the API is stateless and scales horizontally.

## Roadmap (n8n automation)

The disabled menu options will each trigger an n8n workflow via webhook:

- **Track Your Order** — order lookup + carrier tracking
- **Place an Order** — draft order creation
- **Refunds & Returns** — return request intake + approval flow
- **Report a Damaged Product** — complaint ticket with photo upload

Set `N8N_WEBHOOK_URL` in `.env.local` when those workflows are ready.
