import type { NextConfig } from "next";
import path from "node:path";

const apiTarget = process.env.NIXWAY_API_URL ?? "http://localhost:8080";

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiTarget}/api/:path*` },
    ];
  },
};

export default config;
