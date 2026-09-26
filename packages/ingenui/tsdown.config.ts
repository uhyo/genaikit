import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.ts",
    schema: "src/schema.ts",
    server: "src/server.ts",
  },
  format: ["esm"],
  // Emit plain `.js` / `.d.ts` (the package is `"type": "module"`).
  fixedExtension: false,
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // React is a peer and @ingenui/incremental-jsx-parser a regular dependency; neither
  // is bundled.
  deps: {
    neverBundle: ["react", "react-dom", "react/jsx-runtime", "@ingenui/incremental-jsx-parser"],
  },
});
