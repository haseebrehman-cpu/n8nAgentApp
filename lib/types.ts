export type ChatRole = "user" | "assistant";

export interface ChatMessagePayload {
  role: ChatRole;
  content: string;
}

export interface ChatRequestBody {
  messages: ChatMessagePayload[];
}

export interface ChatSuccessResponse {
  reply: string;
}

export interface ChatErrorResponse {
  error: string;
}

export interface ProductVariant {
  id: string;
  title: string;
  price: string;
  availableForSale: boolean;
  inventoryQuantity: number | null;
}

export interface ProductSummary {
  id: string;
  title: string;
  status: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  priceRange: {
    min: string;
    max: string;
    currency: string;
  };
  totalInventory: number | null;
  variants: ProductVariant[];
}
