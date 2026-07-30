import type { ConversationCatalogContext } from "@/lib/chat/context/conversation-context";
import type { SearchFilters } from "@/lib/chat/context/conversation-context";
import type { ShownProduct } from "@/lib/chat/context/product-memory";
import type { DiscoveredCategory } from "@/lib/chat/catalog/category-discovery";
import type {
  ICatalogRepository,
  ICollectionRepository,
} from "@/lib/chat/repositories/types";

export type SearchStrategyName =
  | "context_reuse"
  | "collection_browse"
  | "semantic_product"
  | "count";

export interface StrategyRequest {
  message: string;
  canonicalSearch: string;
  filters: SearchFilters;
  catalogContext?: ConversationCatalogContext | null;
  availableOnly?: boolean;
  forCount?: boolean;
  signal?: AbortSignal;
  categoryMatch?: {
    primary: DiscoveredCategory | null;
    children: DiscoveredCategory[];
    needsClarification: boolean;
  };
}

export interface StrategyResult {
  strategy: SearchStrategyName;
  products: ShownProduct[];
  totalCount: number;
  canonicalSearch: string;
  collectionHandle?: string;
  collectionTitle?: string;
  department?: string;
  category?: string;
  subcategory?: string;
  reusedContext: boolean;
  /** Raw compact JSON for LLM tool path compatibility. */
  compactJson?: string;
  followUpOptions?: string[];
}

export interface StrategyDeps {
  catalogRepo: ICatalogRepository;
  collectionRepo: ICollectionRepository;
}

export interface SearchStrategy {
  readonly name: SearchStrategyName;
  canHandle(request: StrategyRequest): boolean;
  execute(
    request: StrategyRequest,
    deps: StrategyDeps,
  ): Promise<StrategyResult | null>;
}
