import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { UNSUPPORTED_EXPRESSION, type Node } from "./core";
import { parseExpression } from "./expression";
import { createRenderer, type RenderOptions } from "./render";
import { Tokenizer, type Token } from "./tokenizer";
import { TreeBuilder } from "./tree-builder";

function tokenize(input: string): Token[] {
  const tk = new Tokenizer();
  const out = [...tk.write(input), ...tk.end()];
  return out;
}

function build(input: string): readonly Node[] {
  const tk = new Tokenizer();
  const tb = new TreeBuilder();
  for (const token of tk.write(input)) tb.push(token);
  for (const token of tk.end()) tb.push(token);
  tb.end();
  return tb.snapshot({ type: "none" });
}

function toHtml(input: string, options?: RenderOptions): string {
  const r = createRenderer(options);
  return renderToStaticMarkup(createElement(Fragment, null, r.render(build(input))));
}

function Box({ label }: { label?: ReactNode }): ReactNode {
  return createElement("div", { className: "box" }, label);
}

const noJsx = (): undefined => undefined;

describe("parseExpression — literals", () => {
  it("parses numbers", () => {
    expect(parseExpression("42", noJsx)).toBe(42);
    expect(parseExpression("3.14", noJsx)).toBe(3.14);
    expect(parseExpression("-1", noJsx)).toBe(-1);
    expect(parseExpression("1e3", noJsx)).toBe(1000);
    expect(parseExpression(".5", noJsx)).toBe(0.5);
  });

  it("parses keyword literals", () => {
    expect(parseExpression("true", noJsx)).toBe(true);
    expect(parseExpression("false", noJsx)).toBe(false);
    expect(parseExpression("null", noJsx)).toBe(null);
    expect(parseExpression("undefined", noJsx)).toBe(undefined);
  });

  it("parses string and template literals (no substitutions)", () => {
    expect(parseExpression(`"hi"`, noJsx)).toBe("hi");
    expect(parseExpression(`'hi'`, noJsx)).toBe("hi");
    expect(parseExpression(`'a\\nb'`, noJsx)).toBe("a\nb");
    expect(parseExpression("`tpl`", noJsx)).toBe("tpl");
    expect(parseExpression("``", noJsx)).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(parseExpression("  42  ", noJsx)).toBe(42);
    expect(parseExpression("", noJsx)).toBe(undefined);
  });

  it("flags unsupported expressions", () => {
    expect(parseExpression("foo()", noJsx)).toBe(UNSUPPORTED_EXPRESSION);
    expect(parseExpression("a + b", noJsx)).toBe(UNSUPPORTED_EXPRESSION);
    expect(parseExpression("{ a: 1 }", noJsx)).toBe(UNSUPPORTED_EXPRESSION);
    expect(parseExpression("`a${b}c`", noJsx)).toBe(UNSUPPORTED_EXPRESSION);
    expect(parseExpression(`'a' + 'b'`, noJsx)).toBe(UNSUPPORTED_EXPRESSION);
  });

  it("delegates JSX expressions to the parseJsx callback", () => {
    const node: Node = { kind: "text", id: 0, value: "x" };
    const parseJsx = vi.fn(() => node);
    expect(parseExpression("<b>x</b>", parseJsx)).toBe(node);
    expect(parseJsx).toHaveBeenCalledWith("<b>x</b>");
  });
});

describe("Tokenizer — expression containers", () => {
  it("emits a child expr token with raw inner source", () => {
    expect(tokenize("<p>{ 42 }</p>")).toContainEqual<Token>({ type: "expr", raw: " 42 " });
  });

  it("emits an attribute expression token", () => {
    expect(tokenize("<a x={1}>")).toContainEqual<Token>({
      type: "attribute",
      name: "x",
      value: { type: "expression", raw: "1" },
    });
  });

  it("ignores braces and the closing brace inside string literals", () => {
    expect(tokenize(`<p>{"}"}</p>`)).toContainEqual<Token>({ type: "expr", raw: `"}"` });
    expect(tokenize(`<p>{ {a:1} }</p>`)).toContainEqual<Token>({ type: "expr", raw: " {a:1} " });
  });

  it("captures nested JSX (with its own braces) as one expression", () => {
    expect(tokenize("<p>{<b>{1}</b>}</p>")).toContainEqual<Token>({
      type: "expr",
      raw: "<b>{1}</b>",
    });
  });
});

describe("React adapter — expressions in children", () => {
  it("renders number and string literals", () => {
    expect(toHtml("<p>{42}</p>")).toBe("<p>42</p>");
    expect(toHtml(`<p>{'hi'}</p>`)).toBe("<p>hi</p>");
    expect(toHtml("<p>a{1}b{2}c</p>")).toBe("<p>a1b2c</p>");
  });

  it("renders booleans/null/undefined as nothing", () => {
    expect(toHtml("<p>{true}</p>")).toBe("<p></p>");
    expect(toHtml("<p>{null}</p>")).toBe("<p></p>");
    expect(toHtml("<p>{undefined}</p>")).toBe("<p></p>");
  });

  it("renders nested JSX expressions", () => {
    expect(toHtml("<p>{<b>x</b>}</p>")).toBe("<p><b>x</b></p>");
    expect(toHtml("<p>before {<i>mid</i>} after</p>")).toBe("<p>before <i>mid</i> after</p>");
  });
});

describe("React adapter — expressions in props", () => {
  it("renders number and boolean prop values", () => {
    expect(toHtml(`<input maxLength={5}/>`)).toBe(`<input maxLength="5"/>`);
    expect(toHtml(`<input disabled={true}/>`)).toBe(`<input disabled=""/>`);
    expect(toHtml(`<input disabled={false}/>`)).toBe(`<input/>`);
  });

  it("renders a nested JSX prop value", () => {
    expect(toHtml(`<Box label={<b>hi</b>}/>`, { components: { Box } })).toBe(
      `<div class="box"><b>hi</b></div>`,
    );
  });
});

describe("React adapter — unsupported expressions", () => {
  // The errors themselves are reported at parse time via onJsxError
  // ("unsupported-expression"); rendering just degrades silently.
  it("renders nothing (children)", () => {
    expect(toHtml("<p>{foo()}</p>")).toBe("<p></p>");
  });

  it("drops the prop (attributes)", () => {
    expect(toHtml(`<input value={a + b}/>`)).toBe(`<input/>`);
  });
});

describe("Tokenizer — chunking invariance with expressions", () => {
  const input = `<div title={"a}b"}>x{42}y{<b k='}'>z</b>}</div>`;
  it("is invariant for every chunk size", () => {
    const whole = tokenize(input);
    for (let size = 1; size <= input.length; size++) {
      const tk = new Tokenizer();
      const out: Token[] = [];
      for (let i = 0; i < input.length; i += size) out.push(...tk.write(input.slice(i, i + size)));
      out.push(...tk.end());
      expect(out).toEqual(whole);
    }
  });
});
