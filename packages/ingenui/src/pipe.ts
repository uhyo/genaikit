/**
 * `pipeGenUi` — validate a model's stream on the server while passing it
 * through to the client unchanged.
 *
 * The typical server route streams the LLM provider's text to the client as
 * the response body; `pipeGenUi` sits in between, feeding every chunk to a
 * {@link createGenUiValidator | validator} before forwarding it. Issues fire
 * the moment they are parsed (before the client has even received the chunk
 * that completes them), and are available as a whole once the stream ends —
 * so the server can log them, and build the model's feedback itself rather
 * than trusting a report sent back by the client.
 *
 * React-free; works in any runtime with Web Streams (Node 20+, Deno, Bun,
 * Cloudflare Workers, …).
 */

import type { JsxStreamSource } from "@ingenui/incremental-jsx-parser/core";

import type { GenUiIssue } from "./issues";
import type { GenUiSchema } from "./schema";
import type { GenUiValidatorOptions } from "./validator";
import { createGenUiValidator } from "./validator";

export type GenUiPipeOptions = GenUiValidatorOptions;

/** What {@link pipeGenUi} returns. */
export interface GenUiPipe {
  /**
   * The pass-through stream: the source text, UTF-8 encoded — ready to be a
   * `Response` body. It is pull-based: the source is read (and validated) as
   * this stream is consumed. Cancelling it cancels the source.
   */
  readonly stream: ReadableStream<Uint8Array>;
  /**
   * Resolves with all the issues once the source has been fully streamed
   * through (and validated). If the consumer cancels the stream first, it
   * resolves with the issues found up to that point (end-of-message checks
   * such as unclosed fences are skipped). Rejects if the source errors.
   */
  readonly done: Promise<readonly GenUiIssue[]>;
  /** The issues found so far (a snapshot copy). */
  getIssues(): readonly GenUiIssue[];
  /** The issues formatted as feedback for the model, or `null` when clean. */
  getIssueReport(): string | null;
}

function isReadableStream(source: JsxStreamSource): source is ReadableStream<Uint8Array | string> {
  return typeof (source as ReadableStream<unknown>).getReader === "function";
}

function iterate(source: JsxStreamSource): AsyncIterator<string | Uint8Array> {
  if (!isReadableStream(source)) return source[Symbol.asyncIterator]();
  const reader = source.getReader();
  return {
    next: () => reader.read() as Promise<IteratorResult<string | Uint8Array>>,
    async return() {
      await reader.cancel();
      return { done: true, value: undefined };
    },
  };
}

/**
 * Validate `source` against `schema` while passing it through. Accepts the
 * same sources as the client (`ReadableStream` of bytes or strings, or any
 * `AsyncIterable` of either — e.g. an LLM SDK's text-delta stream).
 *
 * ```ts
 * const pipe = pipeGenUi(llmTextStream, schema, { onIssue: (issue) => log(issue) });
 * pipe.done.then((issues) => saveFeedback(formatIssueReport(issues)));
 * return new Response(pipe.stream, { headers: { "content-type": "text/plain; charset=utf-8" } });
 * ```
 */
export function pipeGenUi(
  source: JsxStreamSource,
  schema: GenUiSchema,
  options: GenUiPipeOptions = {},
): GenUiPipe {
  const validator = createGenUiValidator(schema, options);
  const iterator = iterate(source);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let resolveDone!: (issues: readonly GenUiIssue[]) => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<readonly GenUiIssue[]>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // The stream itself errors too; don't make `done` an unhandled rejection
  // for callers who only consume the stream.
  done.catch(() => {});

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Loop until something is enqueued: a pull that enqueues nothing (an
      // empty chunk, a partial UTF-8 sequence) would not be called again.
      for (;;) {
        let result: IteratorResult<string | Uint8Array>;
        try {
          // oxlint-disable-next-line no-await-in-loop -- reading is sequential
          result = await iterator.next();
        } catch (error) {
          rejectDone(error);
          throw error;
        }
        const text = result.done
          ? decoder.decode()
          : typeof result.value === "string"
            ? result.value
            : decoder.decode(result.value, { stream: true });
        if (text !== "") {
          validator.write(text);
          controller.enqueue(encoder.encode(text));
        }
        if (result.done) {
          validator.end();
          controller.close();
          resolveDone(validator.getIssues());
          return;
        }
        if (text !== "") return;
      }
    },
    async cancel() {
      resolveDone(validator.getIssues());
      await iterator.return?.();
    },
  });

  return {
    stream,
    done,
    getIssues: () => validator.getIssues(),
    getIssueReport: () => validator.getIssueReport(),
  };
}
