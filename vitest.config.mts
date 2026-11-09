import { defineConfig } from "vitest/config";
import path from "path";

// Vitest config mirroring tsconfig.json's `@/*` → `./*` path alias so the
// E2E tests can import from `@/engines/...` etc. Vitest reuses the Vite
// plugin pipeline, so `resolve.alias` is what maps `@/*` to the project root.

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
