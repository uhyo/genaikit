import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Resolve the workspace dependency straight to its source (mirrors the
// `paths` mapping in tsconfig.json), so tests run without building it first.
const fromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ingenui/incremental-jsx-parser/react": fromHere("../incremental-jsx-parser/src/react.ts"),
      "@ingenui/incremental-jsx-parser/core": fromHere("../incremental-jsx-parser/src/core.ts"),
      "@ingenui/incremental-jsx-parser": fromHere("../incremental-jsx-parser/src/index.ts"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
  },
});
