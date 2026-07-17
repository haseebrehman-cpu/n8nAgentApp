/** Feature barrel: product catalog + cache. */
export {
  searchProducts,
  getDiscountedProducts,
  lookupCategory,
  findCategoryCollection,
  countByProductType,
  countStorefrontProducts,
} from "@/lib/shopify";
export { cachedProductSearch, normalizeKeyword } from "@/lib/product-cache";
export { toToolProduct, wrapToolData } from "@/lib/catalog/tool-payload";
export type { ProductSummary } from "@/lib/types";
