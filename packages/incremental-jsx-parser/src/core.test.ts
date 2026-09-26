import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createParser } from "./core";

describe("createParser (core push store)", () => {
  it("processes chunks and exposes the live tree", () => {
    const p = createParser();
    p.write("<div>he");
    p.write("llo</div>");
    p.end();
    expect(p.getTree()).toEqual([
      {
        kind: "element",
        id: 0,
        tag: "div",
        props: {},
        children: [{ kind: "text", id: 1, value: "hello" }],
        status: "closed",
      },
    ]);
  });

  it("returns a stable tree reference until the next change", () => {
    const p = createParser();
    p.write("<div>");
    const a = p.getTree();
    expect(p.getTree()).toBe(a);
    p.write("x");
    const b = p.getTree();
    expect(b).not.toBe(a);
    p.end();
    expect(p.getTree()).not.toBe(b);
  });

  it("notifies once per non-empty chunk and on end, then goes quiet", () => {
    const p = createParser();
    let count = 0;
    p.subscribe(() => count++);
    p.write("<div>");
    p.write(""); // empty chunks change nothing
    p.write("x");
    p.end();
    expect(count).toBe(3);

    // Writes and a second end() after end are ignored.
    const tree = p.getTree();
    p.write("<p>late</p>");
    p.end();
    expect(count).toBe(3);
    expect(p.getTree()).toBe(tree);
  });

  it("stops notifying an unsubscribed listener", () => {
    const p = createParser();
    const calls: string[] = [];
    const unsubscribe = p.subscribe(() => calls.push("a"));
    p.subscribe(() => calls.push("b"));
    p.write("<div>");
    unsubscribe();
    p.write("x");
    expect(calls).toEqual(["a", "b", "b"]);
  });

  it("lets a listener unsubscribe itself during a notification", () => {
    const p = createParser();
    const calls: string[] = [];
    const unsubscribe = p.subscribe(() => {
      calls.push("once");
      unsubscribe();
    });
    p.subscribe(() => calls.push("always"));
    p.write("<div>");
    p.write("x");
    expect(calls).toEqual(["once", "always", "always"]);
  });
});

describe("./core entry", () => {
  const srcDir = dirname(fileURLToPath(import.meta.url));

  /** Every bare module specifier statically imported by `entry`, following relative imports. */
  function externalImports(entry: string): Set<string> {
    const specifiers = new Set<string>();
    const visited = new Set<string>();
    const visit = (file: string): void => {
      if (visited.has(file)) return;
      visited.add(file);
      const source = readFileSync(file, "utf8");
      // `… from "x"` plus side-effect `import "x"`.
      for (const match of source.matchAll(/(?:(?:import|export)[^;]*?from|import)\s+"([^"]+)"/g)) {
        const specifier = match[1]!;
        if (specifier.startsWith(".")) visit(`${resolve(dirname(file), specifier)}.ts`);
        else specifiers.add(specifier);
      }
    };
    visit(resolve(srcDir, entry));
    return specifiers;
  }

  it("stays React-free (imports no external module at all)", () => {
    expect([...externalImports("core.ts")]).toEqual([]);
    // Sanity check of the walker itself: the React adapter does reach React.
    expect([...externalImports("index.ts")]).toContain("react");
  });
});
