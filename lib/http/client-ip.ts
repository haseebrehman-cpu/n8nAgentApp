/**
 * Resolve a client identity for rate limiting.
 *
 * Prefer x-real-ip (set by trusted reverse proxies). Fall back to the
 * rightmost X-Forwarded-For hop only when REAL_IP is absent — leftmost
 * hops are spoofable by clients.
 */

import type { NextRequest } from "next/server";

export function getClientIp(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length > 0) {
      // Rightmost hop is typically appended by the last trusted proxy.
      return hops[hops.length - 1]!;
    }
  }

  return "unknown";
}
