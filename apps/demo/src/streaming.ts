/**
 * Build a `ReadableStream<Uint8Array>` that emits `text` a few characters at a
 * time, mimicking how an LLM streams tokens from a server. Encoding to bytes
 * (rather than pushing strings) deliberately exercises the library's streaming
 * `TextDecoder` path — multi-byte characters may split across chunks and the
 * parser must still produce a chunk-independent result.
 */
export interface CharStreamOptions {
  /** Delay between emitted chunks, in milliseconds. */
  intervalMs?: number;
  /** Number of characters released per tick. */
  chunkSize?: number;
  /** Called after each chunk with the full text streamed so far. */
  onProgress?: (streamedSoFar: string) => void;
}

export function createCharStream(
  text: string,
  options: CharStreamOptions = {},
): ReadableStream<Uint8Array> {
  const intervalMs = options.intervalMs ?? 45;
  const chunkSize = Math.max(1, options.chunkSize ?? 2);
  const onProgress = options.onProgress;

  const chars = Array.from(text); // code-point aware, so we never split a char
  const encoder = new TextEncoder();
  let index = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      onProgress?.("");
      timer = setInterval(() => {
        if (index >= chars.length) {
          if (timer) clearInterval(timer);
          timer = undefined;
          controller.close();
          return;
        }
        const next = chars.slice(index, index + chunkSize).join("");
        index += chunkSize;
        controller.enqueue(encoder.encode(next));
        onProgress?.(chars.slice(0, index).join(""));
      }, intervalMs);
    },
    cancel() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  });
}
