import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { JsxErrorEvent } from "./core";
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

  it("keeps the snapshot reference stable between updates (useSyncExternalStore contract)", async () => {
    let controller!: ReadableStreamDefaultController<string>;
    const p = createIncrementalJsxParser(
      new ReadableStream<string>({
        start(c) {
          controller = c;
        },
      }),
    );
    controller.enqueue("<div>a");
    await nextNotify(p);
    const first = p.getSnapshot();
    expect(p.getSnapshot()).toBe(first);

    controller.enqueue("b");
    await nextNotify(p);
    const second = p.getSnapshot();
    expect(second).not.toBe(first);
    expect(p.getSnapshot()).toBe(second);
    controller.close();
    await p.done;
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

  it("rejects done and calls onStreamError on a source read error", async () => {
    const boom = new Error("boom");
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(boom);
      },
    });
    const streamErrors: unknown[] = [];
    const jsxEvents: JsxErrorEvent[] = [];
    const p = createIncrementalJsxParser(failing, {
      onStreamError: (e) => streamErrors.push(e),
      onJsxError: (e) => jsxEvents.push(e),
    });
    await expect(p.done).rejects.toBe(boom);
    expect(streamErrors).toEqual([boom]);
    // Unrecoverable stream failures never leak into the JSX-level channel.
    expect(jsxEvents).toEqual([]);
  });
});
