/**
 * Repository ports for catalog and collection data.
 * Adapters wrap Shopify MCP / Storefront — callers never import infra directly.
 */

export interface CatalogSearchOptions {
  query: string;
  availableOnly?: boolean;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface CatalogProductRef {
  id: string;
  title: string;
  handle?: string;
  url?: string | null;
  price?: string | null;
  wasPrice?: string | null;
  inStock?: boolean | null;
  onSale?: boolean;
  summary?: string | null;
  collections?: string[];
  relevanceScore?: number;
}

export interface CatalogSearchPage {
  rawJson: string;
  products: CatalogProductRef[];
  nextCursor?: string | null;
}

export interface CollectionRef {
  handle: string;
  title: string;
  productsCount: number;
}

export interface CollectionProductsResult {
  products: CatalogProductRef[];
  collection: CollectionRef;
  /** Unique product count after merge/dedupe when multiple handles. */
  totalCount: number;
}

export interface ICatalogRepository {
  searchCatalog(options: CatalogSearchOptions): Promise<CatalogSearchPage>;
  lookupByIds(ids: string[], signal?: AbortSignal): Promise<string>;
  getProduct(id: string, signal?: AbortSignal): Promise<string>;
  searchPolicies(query: string, signal?: AbortSignal): Promise<string>;
}

export interface ICollectionRepository {
  listCollections(signal?: AbortSignal): Promise<CollectionRef[]>;
  fetchCollectionProducts(
    handles: string[],
    options?: {
      availableOnly?: boolean;
      signal?: AbortSignal;
      /** Customer query — used to allow Iconic products when explicitly requested. */
      query?: string;
    },
  ): Promise<CollectionProductsResult | null>;
}
