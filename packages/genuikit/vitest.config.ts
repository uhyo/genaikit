import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Resolve the workspace dependency straight to its source (mirrors the
// `paths` mapping in tsconfig.json), so tests run without building it first.
const fromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "jsx-incremental-parser/react": fromHere("../jsx-incremental-parser/src/react.ts"),
      "jsx-incremental-parser/core": fromHere("../jsx-incremental-parser/src/core.ts"),
      "jsx-incremental-parser": fromHere("../jsx-incremental-parser/src/index.ts"),
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
