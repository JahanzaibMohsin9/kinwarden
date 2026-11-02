import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // a self-contained server for the Docker image (docs/DEPLOY.md)
  output: "standalone",
  // Local plans and credentials must never enter a standalone deployment.
  outputFileTracingExcludes: {
    "/*": [
      "./docs/internal/**/*", "./.internal/**/*", "./.git/**/*",
      "./AGENTS.md", "./CLAUDE.md", "./HACKATHON.md", "./NEAR_HACKATHON_PLAN.md",
      "./.env*", "./.codex/**/*", "./.claude/**/*", "./.mimocode/**/*",
      "./credentials/**/*", "./.near*/**/*", "./public/dev/family-sandbox-key.json",
    ],
  },
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
