import { describe, expect, it } from "vitest";

import { createIncrementalJsxParser } from "./index";
import { createParser } from "./core";

// Smoke tests for the public entry points. Behavioral coverage lives in the
// per-module test files (the React hook in react.test.tsx).

describe("public entry points", () => {
  it("core createParser returns a push-based store", () => {
    const parser = createParser();
    expect(parser.write).toBeTypeOf("function");
    expect(parser.end).toBeTypeOf("function");
    expect(parser.getTree).toBeTypeOf("function");
    expect(parser.subscribe).toBeTypeOf("function");
  });

  it("root createIncrementalJsxParser returns a useSyncExternalStore-shaped store", () => {
    const parser = createIncrementalJsxParser((async function* () {})());
    expect(parser.getSnapshot).toBeTypeOf("function");
    expect(parser.getServerSnapshot).toBeTypeOf("function");
    expect(parser.subscribe).toBeTypeOf("function");
    expect(parser.dispose).toBeTypeOf("function");
    expect(parser.done).toBeInstanceOf(Promise);
  });
});
