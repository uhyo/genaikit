import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

// Resolve `@ingenui/incremental-jsx-parser` (and its subpaths) straight to the library
// source, so the demo always reflects the code in
// `../../packages/incremental-jsx-parser/src` with no build step.
// We don't depend on `@vitejs/plugin-react`; Vite's built-in esbuild transform
// handles `.tsx` using the `jsx: "react-jsx"` setting from `tsconfig.json`.
const fromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: fromHere("."),
  resolve: {
    alias: {
      "@ingenui/incremental-jsx-parser/react": fromHere(
        "../../packages/incremental-jsx-parser/src/react.ts",
      ),
      "@ingenui/incremental-jsx-parser/core": fromHere(
        "../../packages/incremental-jsx-parser/src/core.ts",
      ),
      "@ingenui/incremental-jsx-parser": fromHere(
        "../../packages/incremental-jsx-parser/src/index.ts",
      ),
      "ingenui/react": fromHere("../../packages/ingenui/src/react.ts"),
      ingenui: fromHere("../../packages/ingenui/src/index.ts"),
    },
    // The aliased library source imports `react`/`react-dom` too.
    // Without deduping, the production build resolves those to a separate copy
    // (e.g. the repo-root install) from the demo's own, so the page ships two
    // React instances and hooks crash with "Cannot read properties of null
    // (reading 'useMemo')". Force a single copy from the demo's deps.
    dedupe: ["react", "react-dom"],
  },
  server: {
    // The library source lives outside the demo root (in the workspace's
    // `packages/` directory); allow the dev server to read the whole repo so
    // `pnpm dev` can serve the aliased modules.
    fs: { allow: [fromHere("../..")] },
  },
});
