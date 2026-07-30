/**
 * Iconic Range / Iconic Gear products are a promo line. Do not list or count
 * them in ordinary category/product results unless the customer asks for them.
 */

export interface IconicFilterable {
  title?: string;
  handle?: string;
  url?: string | null;
  collections?: string[];
}

/** True when the customer explicitly asked for Iconic products. */
export function queryRequestsIconic(query: string): boolean {
  return /\biconic\b/i.test(query.trim());
}

/** True when a product is part of the Iconic Range / Iconic Gear line. */
export function isIconicProduct(product: IconicFilterable): boolean {
  const haystack = [
    product.title ?? "",
    product.handle ?? "",
    typeof product.url === "string" ? product.url : "",
    ...(product.collections ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return /\biconic\b/.test(haystack);
}

/**
 * Drop Iconic products unless the query asks for them.
 * Counts and shortlists should use the filtered list.
 */
export function excludeIconicProductsUnlessRequested<T extends IconicFilterable>(
  products: T[],
  query: string,
): T[] {
  if (queryRequestsIconic(query)) return products;
  return products.filter((p) => !isIconicProduct(p));
}
