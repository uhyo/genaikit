import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createParser, type JsxErrorEvent } from "./core";
import { createIncrementalJsxParser, type IncrementalJsxParser } from "./index";

function html(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node));
}

/** A ReadableStream that emits the given chunks then closes. */
function readableFrom<T>(chunks: T[]): ReadableStream<T> {
  let i = 0;
  return new ReadableStream<T>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]!);
      else controller.close();
    },
  });
}

/** An async iterable over the given chunks. */
async function* iterableFrom<T>(chunks: T[]): AsyncGenerator<T> {
  for (const chunk of chunks) yield chunk;
}

function Ellipsis(): ReactNode {
  return createElement("i", null, "…");
}

function nextNotify(parser: IncrementalJsxParser): Promise<void> {
  return new Promise((resolve) => {
    const un = parser.subscribe(() => {
      un();
      resolve();
    });
  });
}

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
    expect(p.getTree()).not.toBe(a);
  });

  it("notifies subscribers once per processed chunk and on end", () => {
    const p = createParser();
    let count = 0;
    p.subscribe(() => count++);
    p.write("<div>");
    p.write("x");
    p.end();
    expect(count).toBe(3);
    const un = p.subscribe(() => count++);
    un();
    p.write("ignored after end");
    expect(count).toBe(3);
  });
});

describe("createIncrementalJsxParser (stream + React)", () => {
  it("renders a string async iterable to a final snapshot", async () => {
    const p = createIncrementalJsxParser(
      iterableFrom(["<div>", "Hello ", "<b>world</b>", "</div>"]),
    );
    await p.done;
    expect(html(p.getSnapshot())).toBe("<div>Hello <b>world</b></div>");
  });

  it("decodes a byte ReadableStream, including a codepoint split across chunks", async () => {
    const bytes = new TextEncoder().encode("<p>café</p>");
    // Split right in the middle of the 2-byte "é".
    const cut = bytes.indexOf(0xc3) + 1; // first byte of "é"
    const p = createIncrementalJsxParser(readableFrom([bytes.slice(0, cut), bytes.slice(cut)]));
    await p.done;
    expect(html(p.getSnapshot())).toBe("<p>café</p>");
  });

  it("accepts a string ReadableStream", async () => {
    const p = createIncrementalJsxParser(readableFrom(["<span>", "hi", "</span>"]));
    await p.done;
    expect(html(p.getSnapshot())).toBe("<span>hi</span>");
  });

  it("produces a chunk-independent final result", async () => {
    const source = "<ul><li>one</li><li>two</li><li>three</li></ul>";
    const splits: string[][] = [
      [source],
      source.split(""),
      [source.slice(0, 7), source.slice(7, 20), source.slice(20)],
    ];
    const results = await Promise.all(
      splits.map(async (chunks) => {
        const p = createIncrementalJsxParser(iterableFrom(chunks));
        await p.done;
        return html(p.getSnapshot());
      }),
    );
    expect(new Set(results)).toEqual(new Set(["<ul><li>one</li><li>two</li><li>three</li></ul>"]));
  });

  it("getSnapshot is referentially stable until the tree changes", async () => {
    const p = createIncrementalJsxParser(iterableFrom(["<div>x</div>"]));
    await p.done;
    expect(p.getSnapshot()).toBe(p.getSnapshot());
  });

  it("dispose() aborts the stream without finalizing the frontier", async () => {
    // A stream that emits one chunk then stays open until cancelled.
    let pulls = 0;
    const stream = new ReadableStream<string>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue("<div>hi");
      },
    });
    const p = createIncrementalJsxParser(stream, { Pending: Ellipsis });
    await nextNotify(p); // first chunk processed
    expect(html(p.getSnapshot())).toBe("<div>hi<i>…</i></div>");

    p.dispose();
    await p.done; // cancelling resolves done

    // Still open (no end()): the frontier placeholder remains.
    expect(html(p.getSnapshot())).toBe("<div>hi<i>…</i></div>");
  });

  it("rejects done and emits a stream-error event on a source read error", async () => {
    const boom = new Error("boom");
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(boom);
      },
    });
    const events: JsxErrorEvent[] = [];
    const p = createIncrementalJsxParser(failing, { onJsxError: (e) => events.push(e) });
    await expect(p.done).rejects.toBe(boom);
    expect(events).toEqual([
      { kind: "stream-error", message: "Stream source failed: Error: boom", error: boom },
    ]);
  });
});
