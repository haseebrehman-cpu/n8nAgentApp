# Shopify AI Chatbot (Next.js + n8n)

Production-ready AI customer support chatbot for a Shopify store.

- **Conversational AI lives inside Next.js** — the `/api/chat` route runs OpenAI with tool calling and queries the Shopify Admin API directly for live product data.
- **n8n is reserved for automation workflows** — order tracking, refunds/returns, and complaint handling will be wired to n8n workflows later. Those menu options currently show "unavailable".

## Features

- Floating chat widget with a welcome message and quick-option buttons:
  - Track Your Order *(coming soon)*
  - **Product Information** *(live)*
  - Place an Order *(coming soon)*
  - Refunds & Returns *(coming soon)*
  - Report a Damaged Product *(coming soon)*
- Live product answers (prices, sizes, variants, stock) pulled from your Shopify catalog — the AI never invents product facts.
- Strictly scoped: refuses off-topic questions and redirects to store topics.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add credentials

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to get it |
|----------|----------------|
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `SHOPIFY_STORE_DOMAIN` | Your store's `*.myshopify.com` domain (no `https://`) |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Shopify admin → **Settings → Apps and sales channels → Develop apps** → Create an app → enable the `read_products` Admin API scope → Install app → reveal the `shpat_...` token |
| `NEXT_PUBLIC_STORE_NAME` | Optional — your store's display name in the widget |

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click the chat bubble.

## Project structure

```
app/
  api/chat/route.ts   # Chat API: OpenAI tool-calling loop + Shopify product search
  page.tsx            # Demo page hosting the widget
components/
  ChatWidget.tsx      # Floating chat widget (welcome message, option buttons, chat UI)
lib/
  shopify.ts          # Shopify Admin GraphQL client (product search)
  system-prompt.ts    # Assistant rules: scope, tool usage, formatting
```

## Roadmap (n8n automation)

The disabled menu options will each trigger an n8n workflow via webhook:

- **Track Your Order** — order lookup + carrier tracking
- **Place an Order** — draft order creation
- **Refunds & Returns** — return request intake + approval flow
- **Report a Damaged Product** — complaint ticket with photo upload

Set `N8N_WEBHOOK_URL` in `.env.local` when those workflows are ready.
