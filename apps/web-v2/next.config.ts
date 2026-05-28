import type { NextConfig } from "next";
import path from "node:path";

const apiTarget = process.env.NIXWAY_API_URL ?? "http://127.0.0.1:8080";

const config: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server.js bundle so the production image stays
  // lean — see apps/web-v2/Dockerfile for the matching runtime stage.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiTarget}/api/:path*` },
    ];
  },
};

export default config;
