import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.ts",
    core: "src/core.ts",
  },
  format: ["esm"],
  // Emit plain `.js` / `.d.ts` (the package is `"type": "module"`).
  fixedExtension: false,
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // React is a peer dependency; never bundle it (or its runtimes).
  deps: {
    neverBundle: ["react", "react-dom", "react/jsx-runtime"],
  },
});
