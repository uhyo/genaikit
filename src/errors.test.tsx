import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createParser, formatJsxError, type JsxErrorEvent, type ParserOptions } from "./core";
import { createIncrementalJsxParser } from "./index";
import { createRenderer } from "./render";
import { Tokenizer } from "./tokenizer";
import { TreeBuilder, type MismatchBehavior } from "./tree-builder";

function html(
  input: string,
  opts: {
    mismatchedTag?: MismatchBehavior;
    end?: boolean;
  } = {},
): string {
  const tk = new Tokenizer();
  const tb = new TreeBuilder({ mismatchedTag: opts.mismatchedTag });
  for (const token of tk.write(input)) tb.push(token);
  if (opts.end ?? true) {
    for (const token of tk.end()) tb.push(token);
    tb.end();
  }
  const r = createRenderer({});
  return renderToStaticMarkup(
    createElement(Fragment, null, r.render(tb.snapshot(tk.getPending()))),
  );
}

describe("Error handling — missing close tags", () => {
  it("auto-closes still-open elements at end of stream", () => {
    expect(html("<div><span>hi")).toBe("<div><span>hi</span></div>");
    // This is JSX, not HTML: unclosed siblings nest, then all auto-close at EOF.
    expect(html("<ul><li>a<li>b")).toBe("<ul><li>a<li>b</li></li></ul>");
  });
});

describe("Error handling — mismatched closing tags", () => {
  it("autoclose (default): a non-matching close ends the innermost element", () => {
    expect(html("<a>x</b>")).toBe("<a>x</a>");
  });

  it("autoclose: a matching ancestor closes intermediate elements", () => {
    expect(html("<a><b>x</a>")).toBe("<a><b>x</b></a>");
  });

  it("ignore: non-matching close tags are dropped", () => {
    expect(html("<a>x</b>y", { mismatchedTag: "ignore" })).toBe("<a>xy</a>");
  });

  it("ignores a stray closing tag with nothing open", () => {
    expect(html("</div>foo")).toBe("foo");
  });
});

describe("Error handling — truncated input", () => {
  it("drops a partial child tag", () => {
    expect(html("<div><spa")).toBe("<div></div>");
  });

  it("drops an element whose opening tag never finished", () => {
    expect(html(`<a href="ab`)).toBe("");
  });

  it("drops a truncated expression", () => {
    expect(html("<p>{42")).toBe("<p></p>");
    expect(html("<p>{<b>unfinished")).toBe("<p></p>");
  });
});

describe("Error handling — last good snapshot is preserved (no end)", () => {
  it("keeps already-parsed content visible mid-stream", () => {
    // Without end(), the frontier Pending (default: null) is present but invisible.
    expect(html("<div>partial", { end: false })).toBe("<div>partial</div>");
  });
});

/** Run `input` through the core parser, collecting unified error events. */
function collectEvents(
  input: string,
  opts: Omit<ParserOptions, "onJsxError"> & { end?: boolean } = {},
): JsxErrorEvent[] {
  const events: JsxErrorEvent[] = [];
  const p = createParser({ ...opts, onJsxError: (e) => events.push(e) });
  p.write(input);
  if (opts.end ?? true) p.end();
  // Note: getTree() is never called — events must not depend on rendering.
  return events;
}

describe("Unified JSX error events (onJsxError)", () => {
  it("reports a mismatched closing tag in every recovery mode", () => {
    for (const mode of ["autoclose", "ignore"] as const) {
      const events = collectEvents("<a>x</b>", { mismatchedTag: mode, end: false });
      expect(events).toMatchObject([
        {
          kind: "mismatched-tag",
          message: "Mismatched closing tag </b>; expected </a>",
          tag: "b",
          expected: "a",
        },
      ]);
    }
  });

  it("keeps recovery behavior unchanged while reporting", () => {
    const onJsxError = vi.fn();
    const tk = new Tokenizer();
    const tb = new TreeBuilder({ onJsxError });
    for (const token of tk.write("<a><b>x</a>")) tb.push(token);
    tb.end();
    const r = createRenderer({});
    const markup = renderToStaticMarkup(
      createElement(Fragment, null, r.render(tb.snapshot(tk.getPending()))),
    );
    expect(markup).toBe("<a><b>x</b></a>");
    expect(onJsxError).toHaveBeenCalledOnce();
    expect(onJsxError.mock.calls[0]![0]).toMatchObject({
      kind: "mismatched-tag",
      message: "Mismatched closing tag </a>; expected </b>",
      tag: "a",
      expected: "b",
    });
  });

  it("reports a stray closing tag with nothing open (expected: null)", () => {
    expect(collectEvents("</div>foo", { end: false })).toMatchObject([
      {
        kind: "mismatched-tag",
        message: "Stray closing tag </div> with nothing open",
        tag: "div",
        expected: null,
      },
    ]);
  });

  it("reports an unknown component at parse time via isKnownComponent", () => {
    const events = collectEvents("<Known><Nope>x</Nope></Known>", {
      isKnownComponent: (tag) => tag === "Known",
    });
    expect(events).toMatchObject([
      { kind: "unknown-component", message: "Unknown component <Nope>", tag: "Nope" },
    ]);
  });

  it("does not treat lowercase (host) tags as components", () => {
    expect(collectEvents("<div><span/></div>", { isKnownComponent: () => false })).toEqual([]);
  });

  it("reports an unsupported child expression with its raw source", () => {
    expect(collectEvents("<p>{foo()}</p>")).toMatchObject([
      {
        kind: "unsupported-expression",
        message: "Unsupported expression: {foo()}",
        expression: "foo()",
      },
    ]);
  });

  it("reports an unsupported attribute expression with the attribute name", () => {
    expect(collectEvents("<input value={a + b}/>")).toMatchObject([
      {
        kind: "unsupported-expression",
        message: 'Unsupported expression in attribute "value": {a + b}',
        expression: "a + b",
        attribute: "value",
      },
    ]);
  });

  it("stays silent for supported expressions", () => {
    expect(collectEvents(`<p title={"t"}>{42}{"s"}{null}</p>`)).toEqual([]);
  });

  it("reports errors inside nested JSX expressions", () => {
    const events = collectEvents("<p>{<Nope/>}</p>", { isKnownComponent: () => false });
    expect(events).toMatchObject([
      { kind: "unknown-component", message: "Unknown component <Nope>", tag: "Nope" },
    ]);
  });

  it("reports unclosed tags at end of input, innermost first", () => {
    expect(collectEvents("<div><span>hi")).toMatchObject([
      { kind: "unclosed-tag", message: "Unclosed tag <span> at end of input", tag: "span" },
      { kind: "unclosed-tag", message: "Unclosed tag <div> at end of input", tag: "div" },
    ]);
    expect(collectEvents("<>x")).toMatchObject([
      { kind: "unclosed-tag", message: "Unclosed fragment <> at end of input", tag: "" },
    ]);
    // A cleanly closed document reports nothing.
    expect(collectEvents("<div>ok</div>")).toEqual([]);
  });

  it("emits the same events regardless of how the input is chunked", () => {
    const input = "<a><B>x</c>{fn()}</a>";
    const opts = { isKnownComponent: () => false };
    const reference = collectEvents(input, opts);
    expect(reference.map((e) => e.kind)).toEqual([
      "unknown-component",
      "mismatched-tag",
      "unsupported-expression",
    ]);
    for (let i = 1; i < input.length; i++) {
      const events: JsxErrorEvent[] = [];
      const p = createParser({ ...opts, onJsxError: (e) => events.push(e) });
      p.write(input.slice(0, i));
      p.write(input.slice(i));
      p.end();
      expect(events).toEqual(reference);
    }
  });
});

describe("Error locations (line / column / lineText)", () => {
  it("locates a mismatched closing tag at its `<`", () => {
    expect(collectEvents("<a>\n  hello</b>", { end: false })).toEqual([
      {
        kind: "mismatched-tag",
        message: "Mismatched closing tag </b>; expected </a>",
        tag: "b",
        expected: "a",
        location: { line: 2, column: 8, offset: 11, lineText: "  hello</b>" },
      },
    ]);
  });

  it("locates unclosed tags at their opening `<`", () => {
    expect(collectEvents("<div>\n  <span>hi").map((e) => e.location)).toEqual([
      { line: 2, column: 3, offset: 8, lineText: "  <span>" },
      { line: 1, column: 1, offset: 0, lineText: "<div>" },
    ]);
  });

  it("captures the whole opening tag in lineText once it completes", () => {
    // The line has streamed past the tag name by the time `>` / `/>` arrives;
    // errors about the element should show the full opening tag.
    const events = collectEvents(`<Widget title="x"/>`, { isKnownComponent: () => false });
    expect(events[0]?.location).toEqual({
      line: 1,
      column: 1,
      offset: 0,
      lineText: `<Widget title="x"/>`,
    });
    expect(collectEvents(`<div id='a'>x`)[0]?.location).toEqual({
      line: 1,
      column: 1,
      offset: 0,
      lineText: "<div id='a'>",
    });
  });

  it("locates an unknown component at its opening `<`", () => {
    const events = collectEvents("<Known>\n  <Nope>x</Nope>\n</Known>", {
      isKnownComponent: (tag) => tag === "Known",
    });
    expect(events[0]?.location).toEqual({
      line: 2,
      column: 3,
      offset: 10,
      lineText: "  <Nope>",
    });
  });

  it("locates an unsupported expression at its `{`", () => {
    expect(collectEvents("<p>{foo()}</p>")[0]?.location).toEqual({
      line: 1,
      column: 4,
      offset: 3,
      lineText: "<p>{foo()}",
    });
    expect(collectEvents("<input value={a + b}/>")[0]?.location).toEqual({
      line: 1,
      column: 14,
      offset: 13,
      lineText: "<input value={a + b}",
    });
  });

  it("reports errors inside a nested JSX expression at the enclosing `{`", () => {
    const events = collectEvents("<p>{<Nope/>}</p>", { isKnownComponent: () => false });
    expect(events[0]?.location).toEqual({
      line: 1,
      column: 4,
      offset: 3,
      lineText: "<p>{<Nope/>}",
    });
  });

  it("emits the same locations regardless of how the input is chunked", () => {
    const input = "<a>\n  <B>x</c>\n  {fn()}\n</a>";
    const opts = { isKnownComponent: () => false };
    const reference = collectEvents(input, opts);
    expect(reference).toHaveLength(3);
    for (let i = 1; i < input.length; i++) {
      const events: JsxErrorEvent[] = [];
      const p = createParser({ ...opts, onJsxError: (e) => events.push(e) });
      p.write(input.slice(0, i));
      p.write(input.slice(i));
      p.end();
      expect(events).toEqual(reference);
    }
  });
});

describe("formatJsxError", () => {
  it("renders message, position and a caret code frame", () => {
    const [event] = collectEvents("<a>hello</b>", { end: false });
    expect(formatJsxError(event!)).toBe(
      "Mismatched closing tag </b>; expected </a> (line 1, column 9)\n" +
        "\n" +
        "  1 | <a>hello</b>\n" +
        "    |         ^",
    );
  });

  it("preserves tabs in the caret padding", () => {
    const out = formatJsxError({
      kind: "mismatched-tag",
      message: "boom",
      tag: "b",
      expected: "a",
      location: { line: 3, column: 6, offset: 20, lineText: "\t<a>x</b>" },
    });
    expect(out).toBe("boom (line 3, column 6)\n\n  3 | \t<a>x</b>\n    | \t    ^");
  });

  it("windows very long lines around the caret", () => {
    const lineText = "x".repeat(149) + "X" + "x".repeat(50);
    const out = formatJsxError({
      kind: "unclosed-tag",
      message: "boom",
      tag: "a",
      location: { line: 1, column: 150, offset: 149, lineText },
    });
    const lines = out.split("\n");
    expect(lines[2]).toContain("…");
    expect(lines[2]!.length).toBeLessThan(100);
    const caret = lines[3]!.indexOf("^");
    expect(lines[2]![caret]).toBe("X");
  });
});

async function* streamOf(...chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

describe("Unified JSX error events — React adapter wiring", () => {
  it("reports an unknown component as soon as it is parsed, before any render", async () => {
    const events: JsxErrorEvent[] = [];
    const parser = createIncrementalJsxParser(streamOf("<Card>", "hi</Card>"), {
      components: {},
      onUnknownComponent: "passthrough", // tolerance mode does not silence the event
      onJsxError: (e) => events.push(e),
    });
    await parser.done;
    // getSnapshot() was never called: the event arrived at parse time.
    expect(events).toMatchObject([
      { kind: "unknown-component", message: "Unknown component <Card>", tag: "Card" },
    ]);
  });

  it("resolves through resolveComponent and the components map", async () => {
    const events: JsxErrorEvent[] = [];
    const parser = createIncrementalJsxParser(streamOf("<A/><B/><C/>"), {
      components: { A: () => null },
      resolveComponent: (name) => (name === "B" ? () => null : undefined),
      onJsxError: (e) => events.push(e),
    });
    await parser.done;
    expect(events).toMatchObject([
      { kind: "unknown-component", message: "Unknown component <C>", tag: "C" },
    ]);
  });

  it("does not probe resolveComponent at parse time without an onJsxError listener", async () => {
    const resolveComponent = vi.fn(() => undefined);
    const parser = createIncrementalJsxParser(streamOf("<Foo/>"), { resolveComponent });
    await parser.done;
    expect(resolveComponent).not.toHaveBeenCalled();
  });
});
