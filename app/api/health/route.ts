import { NextResponse } from "next/server";
import { isConfigError, getOpenAIConfig, getShopifyConfig } from "@/lib/config";
import { probeRedisStatus } from "@/lib/redis";

export const runtime = "nodejs";

/** Lightweight readiness probe — never leaks secrets. */
export async function GET() {
  const checks: Record<string, "ok" | "missing" | "error"> = {
    openai: "missing",
    shopify: "missing",
    redis: "missing",
  };

  try {
    getOpenAIConfig();
    checks.openai = "ok";
  } catch (err) {
    checks.openai = isConfigError(err) ? "missing" : "error";
  }

  try {
    getShopifyConfig();
    checks.shopify = "ok";
  } catch (err) {
    checks.shopify = isConfigError(err) ? "missing" : "error";
  }

  const redis = await probeRedisStatus();
  checks.redis =
    redis.status === "connected"
      ? "ok"
      : redis.status === "skipped"
        ? "missing"
        : "error";

  const ready = checks.openai === "ok" && checks.shopify === "ok";
  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      checks,
      redis: redis.status,
    },
    { status: ready ? 200 : 503 }
  );
}
