/**
 * `createGenUiMessage` — the heart of ingenui.
 *
 * One *message* is one streamed AI response: Markdown text with any number of
 * `ui+jsx` fenced blocks. The stream is split incrementally (see
 * `splitter.ts`); Markdown regions render through the (pluggable) Markdown
 * renderer, and each `ui+jsx` block is piped into its own
 * `createIncrementalJsxParser` so it streams with a live `<Pending />`
 * frontier, wrapped in a per-block error boundary.
 *
 * The returned store is shaped like the underlying parser's — a drop-in for
 * `useSyncExternalStore` — plus the feedback surface: every parse error,
 * render crash, and unclosed fence is collected as a {@link GenUiIssue}, and
 * `getIssueReport()` turns them into the text to send back to the model.
 */

import { Fragment } from "react";
import type { ReactNode } from "react";

import type {
  IncrementalJsxParser,
  IncrementalJsxParserOptions,
} from "@ingenui/incremental-jsx-parser";
import { createIncrementalJsxParser } from "@ingenui/incremental-jsx-parser";
import type { JsxStreamSource } from "@ingenui/incremental-jsx-parser/core";
import { pumpStream } from "@ingenui/incremental-jsx-parser/core";

import type { ActionEvent, ActionsDefinition } from "./actions";
import { withActionsVariable } from "./actions";
import { UiBlockErrorBoundary } from "./boundary";
import type { PushChannel } from "./channel";
import { createPushChannel } from "./channel";
import type { GenUiIssue } from "./issues";
import { describeError, formatIssueReport } from "./issues";
import { renderMarkdown as renderMarkdownDefault } from "./markdown";
import { createFenceSplitter } from "./splitter";

/** Passed to a custom {@link GenUiMessageOptions.renderMarkdown}. */
export interface MarkdownRenderContext {
  /** The region may still grow: its last line is the streaming frontier. */
  streaming: boolean;
}

export interface GenUiMessageOptions extends Omit<
  IncrementalJsxParserOptions,
  "onJsxError" | "onStreamError"
> {
  /**
   * The actions the model may wire into the UI (`onClick={actions.submit}`).
   * Exposed to every `ui+jsx` block as the predefined variable `actions`
   * (each entry declared as `"function"`), overriding any `actions` key in
   * `variables`. See `actions.ts` for the convention.
   */
  actions?: ActionsDefinition | undefined;
  /**
   * Let the model **define its own actions** by referencing them (the
   * default): any `actions.<name>` resolves — an undeclared name becomes a
   * notify-only action (`declared: false` on its {@link ActionEvent}) that
   * emits the canonical message and runs no host code. Pass `false` to opt
   * out and keep the action vocabulary host-owned: a reference outside
   * `actions` is then reported as an `unknown-variable` issue (and with no
   * `actions` declared, the variable does not exist at all).
   */
  dynamicActions?: boolean | undefined;
  /**
   * Called when the user triggers an action. `event.message` is the canonical
   * text to send to the model as the next request.
   */
  onAction?: ((event: ActionEvent) => void) | undefined;
  /**
   * Called for every issue as it is found — JSX parse errors, render crashes,
   * unclosed fences. The same issues accumulate on the message
   * (`getIssues()` / `getIssueReport()`).
   */
  onIssue?: ((issue: GenUiIssue) => void) | undefined;
  /**
   * The channel for **unrecoverable** errors: called once if the stream
   * source fails. Content received so far stays rendered (open blocks are
   * finalized best-effort) and {@link GenUiMessage.done} rejects with the
   * same error.
   */
  onStreamError?: ((error: unknown) => void) | undefined;
  /**
   * Replace the built-in Markdown renderer for the non-UI regions.
   * `context.streaming` is `true` while the region may still grow (it holds
   * the stream's frontier), so a renderer can show unterminated markup
   * optimistically.
   */
  renderMarkdown?: ((markdown: string, context: MarkdownRenderContext) => ReactNode) | undefined;
  /**
   * Rendered in place of a `ui+jsx` block whose UI crashed at render time
   * (default: nothing — the block is hidden).
   */
  renderUiError?: ((blockIndex: number) => ReactNode) | undefined;
}

/**
 * A React-friendly store for one streamed message (the same shape as the
 * parser's store), plus its feedback surface.
 */
export interface GenUiMessage extends IncrementalJsxParser {
  /** Resolves when the stream (and every UI block) completes; rejects on a fatal stream error. */
  readonly done: Promise<void>;
  /** The issues collected so far (a snapshot copy). */
  getIssues(): readonly GenUiIssue[];
  /**
   * The issues formatted as one report addressed to the generating model —
   * the "response to the AI" for a message that had problems — or `null`
   * when the message was clean. Meant to be read after {@link done}.
   */
  getIssueReport(): string | null;
}

interface MarkdownSegment {
  kind: "markdown";
  /** Stable id (creation order) used as the React key. */
  id: number;
  committed: string;
  tail: string;
  cachedFor?: string;
  cachedStreaming?: boolean;
  cachedNode?: ReactNode;
}

interface UiSegment {
  kind: "ui";
  blockIndex: number;
  parser: IncrementalJsxParser;
  channel: PushChannel;
  /** Bumped on every parser update; resets the block's error boundary. */
  version: number;
  lastRenderError?: string;
}

type Segment = MarkdownSegment | UiSegment;

/**
 * Create a message store bound to a stream source (a byte or string
 * `ReadableStream`, or any `AsyncIterable` of either — the same sources the
 * JSX parser accepts). The stream is consumed in the background; read
 * {@link GenUiMessage.getSnapshot} for the current tree and subscribe for
 * updates.
 */
export function createGenUiMessage(
  source: JsxStreamSource,
  options: GenUiMessageOptions = {},
): GenUiMessage {
  const {
    onIssue,
    onStreamError,
    renderMarkdown = renderMarkdownDefault,
    renderUiError,
    ...rest
  } = options;
  const parserOptions: IncrementalJsxParserOptions = withActionsVariable(rest);

  const listeners = new Set<() => void>();
  let version = 0;
  const bump = (): void => {
    version++;
    for (const listener of listeners) listener();
  };

  const issues: GenUiIssue[] = [];
  const recordIssue = (issue: GenUiIssue): void => {
    issues.push(issue);
    onIssue?.(issue);
  };

  const segments: Segment[] = [];
  let currentMarkdown: MarkdownSegment | null = null;
  let currentUi: UiSegment | null = null;
  let uiCount = 0;
  let markdownCount = 0;
  let streaming = true;

  const openMarkdownSegment = (): void => {
    currentMarkdown = { kind: "markdown", id: markdownCount++, committed: "", tail: "" };
    segments.push(currentMarkdown);
  };
  openMarkdownSegment();

  const splitter = createFenceSplitter({
    markdown(text) {
      if (currentMarkdown) currentMarkdown.committed += text;
    },
    markdownTail(tail) {
      if (currentMarkdown) currentMarkdown.tail = tail;
    },
    openUi() {
      currentMarkdown = null;
      const blockIndex = uiCount++;
      const channel = createPushChannel();
      const parser = createIncrementalJsxParser(channel.source, {
        ...parserOptions,
        onJsxError: (event) => recordIssue({ kind: "jsx-error", blockIndex, event }),
      });
      const segment: UiSegment = { kind: "ui", blockIndex, parser, channel, version: 0 };
      parser.subscribe(() => {
        segment.version++;
        bump();
      });
      segments.push(segment);
      currentUi = segment;
    },
    ui(text) {
      currentUi?.channel.push(text);
    },
    closeUi(terminated) {
      const segment = currentUi;
      currentUi = null;
      if (!segment) return;
      segment.channel.close();
      if (!terminated) recordIssue({ kind: "unclosed-fence", blockIndex: segment.blockIndex });
      openMarkdownSegment();
    },
  });

  // Report each distinct crash once, not on every retry.
  const reportRenderError = (segment: UiSegment, error: unknown): void => {
    const described = describeError(error);
    if (segment.lastRenderError === described) return;
    segment.lastRenderError = described;
    recordIssue({ kind: "render-error", blockIndex: segment.blockIndex, error });
  };

  let renderedVersion = -1;
  let renderedNode: ReactNode = null;

  const getSnapshot = (): ReactNode => {
    if (version === renderedVersion) return renderedNode;
    renderedVersion = version;

    const children: ReactNode[] = [];
    for (const segment of segments) {
      if (segment.kind === "markdown") {
        const text = segment.committed + segment.tail;
        if (text === "") continue;
        const segmentStreaming = streaming && segment === currentMarkdown;
        // Cache per text so settled regions keep a stable element identity
        // (cheap React reconciliation), like the parser's frozen subtrees.
        if (segment.cachedFor !== text || segment.cachedStreaming !== segmentStreaming) {
          segment.cachedFor = text;
          segment.cachedStreaming = segmentStreaming;
          segment.cachedNode = (
            <Fragment key={`md-${segment.id}`}>
              {renderMarkdown(text, { streaming: segmentStreaming })}
            </Fragment>
          );
        }
        children.push(segment.cachedNode);
      } else {
        children.push(
          <UiBlockErrorBoundary
            key={`ui-${segment.blockIndex}`}
            resetKey={segment.version}
            fallback={renderUiError?.(segment.blockIndex) ?? null}
            onError={(error) => reportRenderError(segment, error)}
          >
            {segment.parser.getSnapshot()}
          </UiBlockErrorBoundary>,
        );
      }
    }

    // Inside a UI block, the block's own parser renders the frontier.
    const PendingComponent = parserOptions.Pending;
    if (streaming && currentMarkdown !== null && PendingComponent) {
      children.push(<PendingComponent key="pending" />);
    }

    renderedNode = children;
    return renderedNode;
  };

  const handle = pumpStream(source, {
    write(chunk) {
      splitter.write(chunk);
      bump();
    },
    end() {
      splitter.end();
      streaming = false;
      bump();
    },
  });

  const done = handle.done.then(
    async () => {
      // The blocks' own pumps drain asynchronously.
      await Promise.all(segments.flatMap((s) => (s.kind === "ui" ? [s.parser.done] : [])));
    },
    (error: unknown) => {
      // Finalize the open block best-effort so its parser settles; the
      // received content stays rendered.
      streaming = false;
      currentUi?.channel.close();
      onStreamError?.(error);
      bump();
      throw error;
    },
  );

  return {
    getSnapshot,
    getServerSnapshot: getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      handle.cancel();
      currentUi?.channel.close();
      for (const segment of segments) {
        if (segment.kind === "ui") segment.parser.dispose();
      }
    },
    done,
    getIssues: () => issues.slice(),
    getIssueReport: () => formatIssueReport(issues),
  };
}
