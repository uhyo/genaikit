import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Node } from "./core";
import { createRenderer, type RenderOptions } from "./render";
import { Tokenizer } from "./tokenizer";
import { TreeBuilder } from "./tree-builder";

/** Build a live AST snapshot from a JSX string. */
function build(input: string, opts?: { end?: boolean }): readonly Node[] {
  const tk = new Tokenizer();
  const tb = new TreeBuilder();
  for (const token of tk.write(input)) tb.push(token);
  if (opts?.end) {
    for (const token of tk.end()) tb.push(token);
    tb.end();
  }
  return tb.snapshot(tk.getPending());
}

/** Render a snapshot to static HTML. */
function toHtml(nodes: readonly Node[], options?: RenderOptions): string {
  const r = createRenderer(options);
  return renderToStaticMarkup(createElement(Fragment, null, r.render(nodes)));
}

function Card({ children }: { children?: ReactNode }): ReactNode {
  return createElement("div", { className: "card" }, children);
}

function Spinner(): ReactNode {
  return createElement("i", { className: "spin" });
}

describe("React adapter — basics", () => {
  it("renders intrinsic elements with text", () => {
    expect(toHtml(build("<div>Hello</div>", { end: true }))).toBe("<div>Hello</div>");
  });

  it("renders attributes (string + boolean shorthand)", () => {
    expect(toHtml(build(`<input type="text" disabled/>`, { end: true }))).toBe(
      `<input type="text" disabled=""/>`,
    );
  });

  it("renders fragments transparently", () => {
    expect(toHtml(build("<><b>a</b><i>b</i></>", { end: true }))).toBe("<b>a</b><i>b</i>");
  });

  it("default Pending renders nothing", () => {
    expect(toHtml(build("<div>hi"))).toBe("<div>hi</div>");
  });

  it("uses a custom Pending at the frontier", () => {
    expect(toHtml(build("<div>hi"), { Pending: Spinner })).toBe(
      `<div>hi<i class="spin"></i></div>`,
    );
  });
});

describe("React adapter — component resolution", () => {
  it("resolves capitalized tags through the components map", () => {
    expect(toHtml(build("<Card>inside</Card>", { end: true }), { components: { Card } })).toBe(
      `<div class="card">inside</div>`,
    );
  });

  it("resolves through resolveComponent before the map", () => {
    const resolveComponent = vi.fn(() => Card);
    expect(toHtml(build("<Whatever>x</Whatever>", { end: true }), { resolveComponent })).toBe(
      `<div class="card">x</div>`,
    );
    expect(resolveComponent).toHaveBeenCalledWith("Whatever");
  });

  it("unknown component -> Pending by default", () => {
    expect(toHtml(build("<Nope>x</Nope>", { end: true }), { Pending: Spinner })).toBe(
      `<i class="spin"></i>`,
    );
  });

  it("unknown component -> passthrough renders as a host tag", () => {
    expect(
      toHtml(build("<Nope>x</Nope>", { end: true }), { onUnknownComponent: "passthrough" }),
    ).toBe(`<Nope>x</Nope>`);
  });

  it("unknown component -> skip renders nothing", () => {
    // The unresolved tag itself is reported at parse time via onJsxError.
    expect(toHtml(build("<Nope>x</Nope>", { end: true }), { onUnknownComponent: "skip" })).toBe("");
  });
});

describe("React adapter — keys & memoization", () => {
  it("assigns node ids as React keys", () => {
    const r = createRenderer();
    const out = r.render(build("<div>hi")) as ReactElement[];
    expect(out[0]!.key).toBe("0"); // <div> id 0
  });

  it("reuses the React element of a closed subtree across snapshots", () => {
    const tk = new Tokenizer();
    const tb = new TreeBuilder();
    const feed = (s: string) => {
      for (const token of tk.write(s)) tb.push(token);
    };
    const r = createRenderer();

    feed("<div><span>a</span>");
    const out1 = r.render(tb.snapshot(tk.getPending())) as ReactElement[];
    const span1 = (out1[0]!.props as { children: ReactNode[] }).children[0];

    feed("more");
    const out2 = r.render(tb.snapshot(tk.getPending())) as ReactElement[];
    const span2 = (out2[0]!.props as { children: ReactNode[] }).children[0];

    // The closed <span> renders to the very same React element object...
    expect(span2).toBe(span1);
    // ...while the open <div> on the frontier is a fresh element each snapshot.
    expect(out2[0]).not.toBe(out1[0]);
  });
});
