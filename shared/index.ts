/** Shared infrastructure barrel. */
export { getOpenAIConfig, getShopifyConfig, getRedisConfig, isConfigError } from "@/lib/config";
export { getRedis, redisKey, probeRedisStatus } from "@/lib/redis";
export { checkRateLimit } from "@/lib/rate-limit";
export { getClientIp } from "@/lib/http/client-ip";
export { logger } from "@/lib/logger";
export { shopifyAdminGraphql } from "@/lib/shopify/admin-client";
