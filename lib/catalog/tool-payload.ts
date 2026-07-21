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

/** One-line list item — for returning many products without blowing completion tokens. */
export interface CompactToolProduct {
  title: string;
  price: string;
  currency: string;
  onSale: boolean;
  compareAtPrice: string | null;
  inStock: boolean;
  url: string | null;
  optionsSummary: string;
}

const MAX_DESCRIPTION_CHARS = 120;
const MAX_VARIANTS = 8;
const COMPACT_MAX_VARIANTS = 4;

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

export function toCompactToolProduct(product: ProductSummary): CompactToolProduct {
  const variants = product.variants.slice(0, COMPACT_MAX_VARIANTS);
  const inStock = product.variants.some((v) => v.availableForSale);
  const saleVariant = variants.find((v) => v.compareAtPrice);
  const optionsSummary = variants
    .map((v) => v.title)
    .filter(Boolean)
    .join(", ");

  return {
    title: product.title,
    price: product.priceRange.min,
    currency: product.priceRange.currency,
    onSale: product.onSale,
    compareAtPrice: saleVariant?.compareAtPrice ?? null,
    inStock,
    url: product.url,
    optionsSummary: optionsSummary
      ? variants.length < product.variants.length
        ? `${optionsSummary}…`
        : optionsSummary
      : "",
  };
}

/** Prefer in-stock products first for list samples. */
export function prioritizeInStock<
  T extends {
    variants?: { availableForSale: boolean }[];
  },
>(products: T[]): T[] {
  return [...products].sort((a, b) => {
    const aIn = a.variants?.some((v) => v.availableForSale) ? 1 : 0;
    const bIn = b.variants?.some((v) => v.availableForSale) ? 1 : 0;
    return bIn - aIn;
  });
}

export function wrapToolData(payload: unknown): string {
  return `<CATALOG_DATA>\n${JSON.stringify(payload)}\n</CATALOG_DATA>`;
}
