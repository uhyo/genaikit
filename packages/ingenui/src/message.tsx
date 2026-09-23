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
import { createActionsVariable } from "./actions";
import { UiBlockErrorBoundary } from "./boundary";
import type { PushChannel } from "./channel";
import { createPushChannel } from "./channel";
import type { GenUiIssue } from "./issues";
import { formatIssueReport } from "./issues";
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
  actions?: ActionsDefinition;
  /**
   * Let the model **define its own actions** by referencing them (the
   * default): any `actions.<name>` resolves — an undeclared name becomes a
   * notify-only action (`declared: false` on its {@link ActionEvent}) that
   * emits the canonical message and runs no host code. Pass `false` to opt
   * out and keep the action vocabulary host-owned: a reference outside
   * `actions` is then reported as an `unknown-variable` issue (and with no
   * `actions` declared, the variable does not exist at all).
   */
  dynamicActions?: boolean;
  /**
   * Called when the user triggers an action. `event.message` is the canonical
   * text to send to the model as the next request.
   */
  onAction?: (event: ActionEvent) => void;
  /**
   * Called for every issue as it is found — JSX parse errors, render crashes,
   * unclosed fences. The same issues accumulate on the message
   * (`getIssues()` / `getIssueReport()`).
   */
  onIssue?: (issue: GenUiIssue) => void;
  /**
   * The channel for **unrecoverable** errors: called once if the stream
   * source fails. Content received so far stays rendered (open blocks are
   * finalized best-effort) and {@link GenUiMessage.done} rejects with the
   * same error.
   */
  onStreamError?: (error: unknown) => void;
  /**
   * Replace the built-in Markdown renderer for the non-UI regions.
   * `context.streaming` is `true` while the region may still grow (it holds
   * the stream's frontier), so a renderer can show unterminated markup
   * optimistically.
   */
  renderMarkdown?: (markdown: string, context: MarkdownRenderContext) => ReactNode;
  /**
   * Rendered in place of a `ui+jsx` block whose UI crashed at render time
   * (default: nothing — the block is hidden).
   */
  renderUiError?: (blockIndex: number) => ReactNode;
}

/** A React-friendly store for one streamed message, plus its feedback surface. */
export interface GenUiMessage {
  /** Current React snapshot (stable reference until the content changes). */
  getSnapshot(): ReactNode;
  /** SSR-safe snapshot. */
  getServerSnapshot(): ReactNode;
  /** Subscribe to updates; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Cancel the stream and detach. */
  dispose(): void;
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
    actions,
    dynamicActions,
    onAction,
    onIssue,
    onStreamError,
    renderMarkdown,
    renderUiError,
    variables: baseVariables,
    variableTypes: baseVariableTypes,
    ...parserOptions
  } = options;
  const md = renderMarkdown ?? renderMarkdownDefault;

  // Wire the `actions` convention into the predefined variables. Dynamic
  // (model-defined) actions are the default, so the `actions` variable always
  // exists unless the host opts out without declaring any.
  const dynamic = dynamicActions !== false;
  const actionsVariable =
    actions || dynamic ? createActionsVariable(actions ?? {}, onAction, dynamic) : undefined;
  const variables = actionsVariable
    ? { ...baseVariables, actions: actionsVariable.values }
    : baseVariables;
  const variableTypes = actionsVariable
    ? { ...baseVariableTypes, actions: actionsVariable.type }
    : baseVariableTypes;

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
  const blockDones: Promise<void>[] = [];
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
        ...(variables !== undefined && { variables }),
        ...(variableTypes !== undefined && { variableTypes }),
        onJsxError: (event) => recordIssue({ kind: "jsx-error", blockIndex, event }),
      });
      const segment: UiSegment = { kind: "ui", blockIndex, parser, channel, version: 0 };
      parser.subscribe(() => {
        segment.version++;
        bump();
      });
      blockDones.push(parser.done);
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

  const closeOpenChannels = (): void => {
    for (const segment of segments) {
      if (segment.kind === "ui" && !segment.channel.closed) segment.channel.close();
    }
  };

  const reportRenderError = (segment: UiSegment, error: unknown): void => {
    const described = error instanceof Error ? error.message : String(error);
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
              {md(text, { streaming: segmentStreaming })}
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

    // While streaming with the frontier in Markdown, show the Pending
    // placeholder at the end (inside a UI block, the block's own parser
    // renders it).
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
      // The blocks' own pumps drain asynchronously; the message is done when
      // every block is.
      await Promise.all(blockDones);
    },
    (error: unknown) => {
      // Finalize open blocks best-effort so their parsers settle; the
      // received content stays rendered.
      streaming = false;
      closeOpenChannels();
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
      closeOpenChannels();
      for (const segment of segments) {
        if (segment.kind === "ui") segment.parser.dispose();
      }
    },
    done,
    getIssues: () => issues.slice(),
    getIssueReport: () => formatIssueReport(issues),
  };
}
