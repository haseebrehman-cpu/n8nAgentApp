import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const { executeSemanticSearch } = await import(
  "../lib/chat/search/orchestrator"
);

const r = await executeSemanticSearch({
  query: "i need to buy a shin guard",
  lastUser: "i need to buy a shin guard",
});
const j = JSON.parse(r.compactJson) as {
  products?: { title?: string }[];
  countIsExactCategoryTotal?: boolean;
};
console.log(
  JSON.stringify(
    {
      productCount: r.productCount,
      confidence: r.confidence,
      effectiveQuery: r.effectiveQuery,
      titles: (j.products || []).slice(0, 8).map((p) => p.title),
      exact: j.countIsExactCategoryTotal,
    },
    null,
    2,
  ),
);
