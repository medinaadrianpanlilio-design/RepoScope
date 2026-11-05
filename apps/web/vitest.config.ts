import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: {
      "@reposcope/engine": fileURLToPath(new URL("../../packages/engine/src/index.ts", import.meta.url)),
      "@": fileURLToPath(new URL(".", import.meta.url)),
    } },
  test: { include: ["lib/**/*.test.ts"] },
});
