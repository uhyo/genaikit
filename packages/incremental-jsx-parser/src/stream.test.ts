import { describe, expect, it } from "vitest";

import { pumpStream, type JsxStreamSource } from "./stream";

/** A sink recording every call, with `"<end>"` marking `end()`. */
function recordingSink(): { calls: string[]; write(chunk: string): void; end(): void } {
  const calls: string[] = [];
  return { calls, write: (chunk) => calls.push(chunk), end: () => calls.push("<end>") };
}

function readableFrom<T>(chunks: T[]): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function* iterableFrom<T>(chunks: T[]): AsyncGenerator<T> {
  for (const chunk of chunks) yield chunk;
}

/** "é" is two UTF-8 bytes; split the encoding of `text` inside it. */
function splitInsideEAcute(text: string): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const cut = bytes.indexOf(0xc3) + 1;
  return [bytes.slice(0, cut), bytes.slice(cut)];
}

describe("pumpStream", () => {
  const sources: [name: string, make: (chunks: (string | Uint8Array)[]) => JsxStreamSource][] = [
    ["ReadableStream", (chunks) => readableFrom(chunks) as JsxStreamSource],
    ["AsyncIterable", (chunks) => iterableFrom(chunks)],
  ];

  for (const [name, make] of sources) {
    it(`forwards string chunks from a ${name}, then ends the sink`, async () => {
      const sink = recordingSink();
      await pumpStream(make(["<a>", "", "b</a>"]), sink).done;
      // Empty chunks are not forwarded.
      expect(sink.calls).toEqual(["<a>", "b</a>", "<end>"]);
    });

    it(`decodes bytes from a ${name}, reassembling a split code point`, async () => {
      const sink = recordingSink();
      await pumpStream(make(splitInsideEAcute("<p>café</p>")), sink).done;
      expect(sink.calls.slice(0, -1).join("")).toBe("<p>café</p>");
      expect(sink.calls.at(-1)).toBe("<end>");
    });
  }

  it("flushes a truncated trailing code point as U+FFFD before ending", async () => {
    const sink = recordingSink();
    const [head] = splitInsideEAcute("café");
    await pumpStream(readableFrom([head!]), sink).done;
    expect(sink.calls).toEqual(["caf", "�", "<end>"]);
  });

  it("cancel() aborts a ReadableStream source without ending the sink", async () => {
    let cancelled = false;
    let pulls = 0;
    const source = new ReadableStream<string>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue("<div>");
        // Afterwards the source stays open until cancelled.
      },
      cancel() {
        cancelled = true;
      },
    });
    const sink = recordingSink();
    const handle = pumpStream(source, sink);
    await new Promise((resolve) => setTimeout(resolve, 0));
    handle.cancel();
    await handle.done;
    expect(cancelled).toBe(true);
    expect(sink.calls).toEqual(["<div>"]);
  });

  it("cancel() stops consuming an AsyncIterable without ending the sink", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* source(): AsyncGenerator<string> {
      yield "<div>";
      await gate;
      yield "late";
    }
    const sink = recordingSink();
    const handle = pumpStream(source(), sink);
    await new Promise((resolve) => setTimeout(resolve, 0));
    handle.cancel();
    release();
    await handle.done;
    expect(sink.calls).toEqual(["<div>"]);
  });

  it("rejects done on a read error without ending the sink", async () => {
    const boom = new Error("boom");
    async function* failing(): AsyncGenerator<string> {
      yield "<div>";
      throw boom;
    }
    const sink = recordingSink();
    await expect(pumpStream(failing(), sink).done).rejects.toBe(boom);
    expect(sink.calls).toEqual(["<div>"]);
  });
});
