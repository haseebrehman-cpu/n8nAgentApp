// Throwaway: does MCP truncate per-product collections?
const DOMAIN = "rdx-sports-store.myshopify.com";
const PROFILE =
  "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json";

const res = await fetch(`https://${DOMAIN}/api/ucp/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    id: 1,
    params: {
      name: "search_catalog",
      arguments: {
        meta: { "ucp-agent": { profile: PROFILE } },
        catalog: {
          query: "kids boxing sets",
          context: { address_country: "GB" },
          filters: { available: false },
          pagination: { limit: 50 },
        },
      },
    },
  }),
});
const json = await res.json();
const parsed = JSON.parse(
  (json.result?.content ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n"),
);

const target = parsed.products.find((p) =>
  /F6 Kids 6oz KARA Boxing Gloves/i.test(p.title ?? ""),
);
console.log("=== product:", target?.title);
console.log("MCP collections:", (target?.collections ?? []).map((c) => c.handle));
console.log("count:", (target?.collections ?? []).length);
console.log(
  "\nper-product collections array lengths (first 20):",
  parsed.products.slice(0, 20).map((p) => (p.collections ?? []).length),
);
console.log(
  "\nany product listing kids-boxing-sets?",
  parsed.products.some((p) =>
    (p.collections ?? []).some((c) => c.handle === "kids-boxing-sets"),
  ),
);
