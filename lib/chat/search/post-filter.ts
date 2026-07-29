/**
 * Post-retrieval filters for ecommerce correctness: on-sale only, budget caps.
 * Applied after MCP/collection results are compacted so the model never
 * recommends over-budget or non-sale items when the customer asked for them.
 */

export interface FilterableProduct {
  id?: string;
  title: string;
  price?: string | null;
  wasPrice?: string | null;
  onSale?: boolean;
}

function parsePriceAmount(price: string | null | undefined): number | null {
  if (!price) return null;
  const m = String(price).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Keep products at or under budgetMax (major currency units).
 * Products without a parseable price are dropped when a budget is active.
 */
export function filterProductsByBudget<T extends FilterableProduct>(
  products: T[],
  budgetMax: number,
): T[] {
  if (!(budgetMax > 0) || products.length === 0) return products;
  return products.filter((p) => {
    const amount = parsePriceAmount(p.price);
    return amount != null && amount <= budgetMax;
  });
}

/** Keep products explicitly on sale (onSale flag or wasPrice present). */
export function filterProductsOnSale<T extends FilterableProduct>(
  products: T[],
): T[] {
  return products.filter(
    (p) => p.onSale === true || Boolean(p.wasPrice?.trim()),
  );
}

/**
 * Apply journey-aware filters to compacted catalog JSON.
 * Returns the original string if parsing fails or filters leave nothing
 * useful (caller may then broaden).
 */
export function applyCatalogPostFilters(
  compactJson: string,
  options: { budgetMax?: number; onSaleOnly?: boolean },
): { json: string; filtered: boolean; productCount: number } {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(compactJson) as Record<string, unknown>;
  } catch {
    return { json: compactJson, filtered: false, productCount: 0 };
  }

  if (!Array.isArray(obj.products)) {
    return {
      json: compactJson,
      filtered: false,
      productCount: typeof obj.productCount === "number" ? obj.productCount : 0,
    };
  }

  let products = obj.products as FilterableProduct[];
  const before = products.length;

  if (options.onSaleOnly) {
    products = filterProductsOnSale(products);
  }
  if (options.budgetMax != null) {
    products = filterProductsByBudget(products, options.budgetMax);
  }

  if (products.length === before) {
    return {
      json: compactJson,
      filtered: false,
      productCount: before,
    };
  }

  obj.products = products;
  obj.productCount = products.length;
  obj.postFiltered = true;
  if (options.onSaleOnly) obj.onSaleOnly = true;
  if (options.budgetMax != null) obj.budgetMax = options.budgetMax;

  return {
    json: JSON.stringify(obj),
    filtered: true,
    productCount: products.length,
  };
}
