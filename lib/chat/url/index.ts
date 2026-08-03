/**
 * RDX storefront URL handling — detect, validate, parse, dispatch via MCP.
 */

export { OFFICIAL_RDX_HOSTS, isOfficialRdxHost } from "@/lib/chat/url/domains";
export { validateRdxUrl } from "@/lib/chat/url/validator";
export {
  extractUrlsFromMessage,
  messageContainsUrl,
  parseMessageUrls,
} from "@/lib/chat/url/parser";
export {
  detectRdxResourceType,
  resourceTypeLabel,
  type DetectedRdxResource,
  type RdxResourceType,
} from "@/lib/chat/url/resource-type";
export {
  dispatchRdxResource,
  dispatchRdxResources,
} from "@/lib/chat/url/dispatcher";
export {
  tryResolveRdxUrlTurn,
  type RdxUrlDecision,
} from "@/lib/chat/url/handler";
export {
  NON_OFFICIAL_RDX_URL_REPLY,
  INVALID_URL_REPLY,
  UNSUPPORTED_RDX_PAGE_REPLY,
  RESOURCE_NOT_FOUND_REPLY,
  MCP_FAILURE_REPLY,
} from "@/lib/chat/url/replies";
