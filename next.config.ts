import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep ioredis out of the bundler — uses Node net/TLS at runtime
  serverExternalPackages: ["ioredis"],
};

export default nextConfig;
