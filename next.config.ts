import type { NextConfig } from "next";

// Browser → Next.js → FastAPI.
// 1. If API_INTERNAL_URL is set (e.g. backend on Render/Railway), proxy to that URL.
// 2. In local development without env var, proxy to local FastAPI on http://127.0.0.1:8000.
// 3. On Vercel without external URL, let Vercel route /api directly to the serverless Python function.
const API_URL = process.env.API_INTERNAL_URL;

const nextConfig: NextConfig = {
  // Docker images use the standalone server (NEXT_OUTPUT=standalone); `next start` is used locally.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    if (API_URL) {
      return [{ source: "/api/:path*", destination: `${API_URL.replace(/\/$/, "")}/api/:path*` }];
    }
    if (process.env.NODE_ENV === "development") {
      return [{ source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" }];
    }
    // On Vercel deployment, /api is handled natively by the serverless function
    return [];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
