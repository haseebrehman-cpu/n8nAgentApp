/**
 * Slim catalog payloads for the LLM — cuts tokens without changing storefront facts.
 */

import type { ProductSummary } from "@/lib/types";

export interface ToolProductVariant {
  title: string;
  price: string;
  compareAtPrice: string | null;
  inStock: boolean;
}

export interface ToolProduct {
  title: string;
  priceMin: string;
  priceMax: string;
  currency: string;
  onSale: boolean;
  inStock: boolean;
  url: string | null;
  description: string;
  options: ToolProductVariant[];
}

const MAX_DESCRIPTION_CHARS = 120;
const MAX_VARIANTS = 8;

export function toToolProduct(product: ProductSummary): ToolProduct {
  const variants = product.variants.slice(0, MAX_VARIANTS).map((v) => ({
    title: v.title,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    inStock: v.availableForSale,
  }));

  return {
    title: product.title,
    priceMin: product.priceRange.min,
    priceMax: product.priceRange.max,
    currency: product.priceRange.currency,
    onSale: product.onSale,
    inStock: variants.some((v) => v.inStock),
    url: product.url,
    description: product.description
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_DESCRIPTION_CHARS),
    options: variants,
  };
}

export function wrapToolData(payload: unknown): string {
  return `<CATALOG_DATA>\n${JSON.stringify(payload)}\n</CATALOG_DATA>`;
}
