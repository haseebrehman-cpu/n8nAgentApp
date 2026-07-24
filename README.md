# Shopify AI Chatbot (Next.js)

Production-oriented AI customer support chatbot for a Shopify store.

- **Conversational AI lives inside Next.js** — `/api/chat` runs an OpenAI tool-calling agent against the Shopify Admin API.
- **n8n is reserved for future automation** — refunds/returns and complaint handling.

## Features

- Floating chat widget (home + `/embed`) with quick options
- Live product search (prices, variants, stock, storefront links)
- Order tracking with **order number + checkout email** ownership check
- Market-aware pricing via `SHOPIFY_MARKET_COUNTRY`
- Redis-backed product cache, chat sessions, and rate limits
- SSE streaming replies (`?stream=1`) with JSON fallback
- Health probe at `GET /api/health`

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

Copy [`.env.example`](.env.example) to `.env.local` and fill in values.

| Variable | Required | Notes |
|----------|----------|--------|
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `OPENAI_MODEL` | No | Default `gpt-4o-mini` |
| `SHOPIFY_STORE_DOMAIN` | Yes | `*.myshopify.com` (no protocol) |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Yes | Needs `read_products` (size charts + exact inventory quantities) + `read_orders` |
| `SHOPIFY_MARKET_COUNTRY` | No | ISO-2 market code |
| `SHOPIFY_STOREFRONT_URL` | No | Origin for product links |
| `SHOPIFY_SIZE_CHART_METAFIELD_NAMESPACE` | No | Default `custom` — product metafield namespace for size charts |
| `SHOPIFY_SIZE_CHART_METAFIELD_KEY` | No | Default tries `sizeguide`, then `size_chart`, then `size_guide`. Set to force a single key. |
| `REDIS_URL` | Production: Yes | `redis://` or `rediss://` |
| `NEXT_PUBLIC_STORE_NAME` | No | Widget display name |
| `NEXT_PUBLIC_STOREFRONT_HOST` | No | Hostname allowlist for chat links **and** size-chart CDN paths (`/cdn/shop/files/`) |

### 3. Run

```bash
npm run dev
```

Open [http://localhost:4000](http://localhost:4000).

### 4. Verify

```bash
npm run lint
npm test
npm run build
```

## Architecture

```
app/api/chat/                 # Chat + order-tracking HTTP
app/api/health/               # Readiness probe
components/chat/              # Widget + markdown
features/                     # Feature barrels (chat, catalog, order-tracking)
shared/                       # Infra barrel
lib/chat/                     # Session + SSE
lib/shopify/                  # Shared Admin GraphQL client
services/shopify/             # Credentials + order GraphQL
```

### Request flow

1. Widget POSTs `{ message }` to `/api/chat?stream=1` (SSE) or JSON.
2. Server session cookie stores history + conversation state (not client-authored assistant turns).
3. Rate limit buckets: `chat` (20/min) and `order` (8/min).
4. Agent tools call cached Shopify catalog / ownership-checked order lookup.
5. Reply is media-stripped and sanitized on render (`rehype-sanitize`).

### Production notes

- Put the app behind a reverse proxy that sets `X-Real-IP` (or trusted `X-Forwarded-For`).
- Redis is required for multi-instance rate limits, sessions, and product cache. When Redis is configured but down in production, rate limiting **fail-closes**.
- Order tracking never returns shipment details without a matching checkout email; miss and mismatch share the same generic message.
- Full-catalog order scans are disabled (cheap Admin search only).

## Order tracking API

`POST /api/chat/order-tracking`

```json
{
  "orderNumber": "#1001",
  "email": "customer@example.com",
  "region": "default"
}
```

## Chat API

JSON (backward compatible):

```json
POST /api/chat
{ "message": "Do you have boxing gloves?" }
→ { "reply": "...", "requestId": "...", "attachments": [] }
```

When a verified size chart is available, `attachments` may include:

```json
{
  "kind": "size_chart",
  "productId": "gid://shopify/Product/123",
  "productTitle": "RDX Boxing Gloves AS2",
  "url": "https://rdxsports.co.uk/cdn/shop/files/BGR-AS2_Size_Chart_new.webp?v=1",
  "altText": "Size chart for RDX Boxing Gloves AS2",
  "width": 1000,
  "height": 800
}
```

Streaming:

```http
POST /api/chat?stream=1
Accept: text/event-stream
```

SSE events: `{ type: "delta", text }`, `{ type: "done", reply, requestId, attachments? }`, `{ type: "error", error }`.

Legacy `{ "messages": [...] }` is accepted but **only the last user message** is used; assistant roles from the client are ignored.

### Product size charts

1. In Shopify Admin, product metafield `custom.sizeguide` (type **File** / `file_reference`, or **URL**). Also accepts `custom.size_chart` / `custom.size_guide`.
2. Attach the size-chart image (store files under `/cdn/shop/files/…`).
3. Ensure `NEXT_PUBLIC_STOREFRONT_HOST` matches your public storefront host so chart URLs are allowlisted.
4. The chat agent calls `get_size_chart` with a product id; the image is delivered as a typed attachment (not as model-authored markdown). Arbitrary assistant images remain blocked.

## Roadmap (n8n)

Disabled menu options will call n8n webhooks when ready (`N8N_WEBHOOK_URL`).
