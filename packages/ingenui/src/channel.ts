/**
 * A minimal single-consumer push channel: string chunks pushed on one side
 * come out of an `AsyncIterable` on the other. Each `ui+jsx` block gets one
 * of these so its JSX source can be fed into `createIncrementalJsxParser`
 * (which consumes a stream source) as the splitter extracts it from the
 * surrounding Markdown stream.
 */

export interface PushChannel {
  /** The consumer side; hand this to the JSX parser as its stream source. */
  readonly source: AsyncIterable<string>;
  /** Append a chunk. No-op after {@link close}. */
  push(chunk: string): void;
  /** Signal end of input. Idempotent. */
  close(): void;
  /** Whether {@link close} has been called. */
  readonly closed: boolean;
}

export function createPushChannel(): PushChannel {
  const buffer: string[] = [];
  let closed = false;
  let wake: (() => void) | undefined;

  const source: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<string>> {
          for (;;) {
            if (buffer.length > 0) return { done: false, value: buffer.shift()! };
            if (closed) return { done: true, value: undefined };
            // Wait until the producer pushes or closes.
            // oxlint-disable-next-line no-await-in-loop
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        },
      };
    },
  };

  return {
    source,
    push(chunk) {
      if (closed || chunk === "") return;
      buffer.push(chunk);
      wake?.();
      wake = undefined;
    },
    close() {
      closed = true;
      wake?.();
      wake = undefined;
    },
    get closed() {
      return closed;
    },
  };
}
