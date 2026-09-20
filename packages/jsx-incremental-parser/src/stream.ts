/**
 * Stream driver (PLAN.md §4.1): normalizes the accepted source types into a
 * sequence of string chunks and pumps them into a sink in a background loop.
 *
 * Bytes are decoded with a single streaming {@link TextDecoder} so a multi-byte
 * UTF-8 codepoint split across chunk boundaries is reassembled correctly
 * (PLAN.md §5). `ReadableStream` is consumed via its reader so {@link pumpStream}
 * can cancel an in-flight read on dispose; other async iterables are consumed
 * with `for await`.
 */

/** Accepted stream sources. */
export type JsxStreamSource =
  | ReadableStream<Uint8Array>
  | ReadableStream<string>
  | AsyncIterable<string | Uint8Array>;

/** Where decoded string chunks are delivered. */
export interface StreamSink {
  write(chunk: string): void;
  end(): void;
}

/** A running stream pump. */
export interface StreamHandle {
  /** Resolves when the source is fully consumed; rejects on a read error. */
  readonly done: Promise<void>;
  /** Stop reading and abort the source without ending the sink. */
  cancel(): void;
}

function isReadableStream(source: JsxStreamSource): source is ReadableStream<Uint8Array | string> {
  return typeof (source as ReadableStream<unknown>).getReader === "function";
}

/** Start consuming `source`, forwarding decoded chunks to `sink`. */
export function pumpStream(source: JsxStreamSource, sink: StreamSink): StreamHandle {
  let cancelled = false;
  let reader: ReadableStreamDefaultReader<Uint8Array | string> | undefined;

  const cancel = (): void => {
    cancelled = true;
    reader?.cancel().catch(() => {});
  };

  const done = (async (): Promise<void> => {
    const decoder = new TextDecoder();
    const decode = (value: Uint8Array | string): string =>
      typeof value === "string" ? value : decoder.decode(value, { stream: true });

    if (isReadableStream(source)) {
      reader = source.getReader();
      try {
        for (;;) {
          // Reading a stream is inherently sequential.
          // oxlint-disable-next-line no-await-in-loop
          const { done: streamDone, value } = await reader.read();
          if (streamDone || cancelled) break;
          const chunk = decode(value);
          if (chunk) sink.write(chunk);
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      for await (const value of source) {
        if (cancelled) break;
        const chunk = decode(value);
        if (chunk) sink.write(chunk);
      }
    }

    if (cancelled) return;
    const tail = decoder.decode();
    if (tail) sink.write(tail);
    sink.end();
  })();

  return { done, cancel };
}
