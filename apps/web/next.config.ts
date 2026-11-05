import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Bundled so nothing has to link to the engine's copy, which fails on exFAT (ADR 0002).
  transpilePackages: ["typescript"],
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
