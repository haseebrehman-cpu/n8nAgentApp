export type {
  CatalogProductRef,
  CatalogSearchOptions,
  CatalogSearchPage,
  CollectionProductsResult,
  CollectionRef,
  ICatalogRepository,
  ICollectionRepository,
} from "@/lib/chat/repositories/types";

export {
  McpCatalogRepository,
  createCatalogRepository,
} from "@/lib/chat/repositories/catalog-repository";

export {
  StorefrontCollectionRepository,
  createCollectionRepository,
} from "@/lib/chat/repositories/collection-repository";
