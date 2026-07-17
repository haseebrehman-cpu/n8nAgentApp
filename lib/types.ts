export type ChatRole = "user" | "assistant";

export interface ChatMessagePayload {
  role: ChatRole;
  content: string;
}

export interface ChatRequestBody {
  /** Preferred: single user turn; server owns history. */
  message?: string;
  /** Legacy: full history — only the last user message is used. */
  messages?: ChatMessagePayload[];
  region?: string;
}

export interface ChatSuccessResponse {
  reply: string;
  requestId?: string;
}

export interface ChatErrorResponse {
  error: string;
}

export interface ProductVariant {
  id: string;
  title: string;
  price: string;
  /** Original ("was") price when the variant is discounted; null otherwise. */
  compareAtPrice: string | null;
  availableForSale: boolean;
  inventoryQuantity: number | null;
}

export interface ProductSummary {
  id: string;
  title: string;
  status: string;
  /** URL-safe storefront slug from Shopify. */
  handle: string;
  /**
   * Public product page URL for the customer storefront.
   * Null when neither SHOPIFY_STOREFRONT_URL nor Shopify onlineStoreUrl is available.
   */
  url: string | null;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  priceRange: {
    min: string;
    max: string;
    currency: string;
  };
  /** True when at least one variant has a compare-at price above its price. */
  onSale: boolean;
  totalInventory: number | null;
  variants: ProductVariant[];
}
