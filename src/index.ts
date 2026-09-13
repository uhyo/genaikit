/**
 * React adapter — the primary, documented entry point
 * (`jsx-incremental-parser`).
 *
 * Wraps the framework-agnostic {@link createParser | core} and converts the AST
 * snapshot into a `React.ReactNode`, injecting a `<Pending />` placeholder at
 * the streaming frontier (PLAN.md §3.1, §4.5). The returned object is shaped to
 * be a drop-in for React's `useSyncExternalStore`.
 */

import type { ComponentType, ReactNode } from "react";

import type { JsxErrorEvent, MismatchBehavior, Node } from "./core";
import { createParser } from "./core";
import { createRenderer } from "./render";
import type { JsxStreamSource } from "./stream";
import { pumpStream } from "./stream";

export type {
  Node,
  ElementNode,
  FragmentNode,
  TextNode,
  ExpressionNode,
  PendingNode,
  PropValue,
  MismatchBehavior,
  JsxErrorEvent,
  JsxErrorListener,
} from "./core";
export type { JsxStreamSource } from "./stream";
export { Pending } from "./render";

/** How to handle a component tag that is not in the `components` map. */
export type UnknownComponentBehavior = "pending" | "error" | "passthrough";

export interface IncrementalJsxParserOptions {
  /** Tag name -> React component map for capitalized JSX names. */
  components?: Record<string, ComponentType<never>>;
  /** Placeholder rendered at the streaming frontier (default: renders null). */
  Pending?: ComponentType<unknown>;
  /** Optional resolver, consulted before the `components` map. */
  resolveComponent?: (name: string) => ComponentType<never> | undefined;
  /** Behavior for an unresolved component tag (default: "pending"). */
  onUnknownComponent?: UnknownComponentBehavior;
  /** Closing-tag mismatch strategy (default: "autoclose"). */
  mismatchedTag?: MismatchBehavior;
  /** Called on a recoverable parse/stream/render error. */
  onError?: (error: unknown, info: { phase: string }) => void;
  /**
   * Unified structured JSX-level error events (mismatched/unclosed tags,
   * unknown components, unsupported expressions), fired synchronously **as
   * soon as each error is parsed** — before any render, and in every
   * `mismatchedTag` / `onUnknownComponent` mode. Recovery is unaffected, so
   * this is the channel to feed instant feedback to a stream producer.
   */
  onJsxError?: (event: JsxErrorEvent) => void;
}

/**
 * A React-friendly store: drop-in shaped for `useSyncExternalStore`
 * (`subscribe` + `getSnapshot`), plus lifecycle helpers.
 */
export interface IncrementalJsxParser {
  /** Current React snapshot (stable reference until the tree changes). */
  getSnapshot(): ReactNode;
  /** SSR-safe snapshot. */
  getServerSnapshot(): ReactNode;
  /** Subscribe to updates; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Cancel the stream and detach. */
  dispose(): void;
  /** Resolves when the stream completes, rejects on fatal error. */
  readonly done: Promise<void>;
}

/**
 * Create an incremental JSX parser bound to a stream source. The stream is
 * consumed in the background; read {@link IncrementalJsxParser.getSnapshot} for
 * the current React tree and {@link IncrementalJsxParser.subscribe} for updates.
 */
export function createIncrementalJsxParser(
  source: JsxStreamSource,
  options: IncrementalJsxParserOptions = {},
): IncrementalJsxParser {
  const core = createParser({
    mismatchedTag: options.mismatchedTag,
    onError: options.onError,
    onJsxError: options.onJsxError,
    // Only probe component resolution at parse time when someone listens, so
    // `resolveComponent` sees no extra calls otherwise.
    isKnownComponent: options.onJsxError
      ? (tag) => (options.resolveComponent?.(tag) ?? options.components?.[tag]) != null
      : undefined,
  });
  const renderer = createRenderer(options);

  let lastTree: readonly Node[] | undefined;
  let lastNode: ReactNode = null;

  const getSnapshot = (): ReactNode => {
    const tree = core.getTree();
    if (tree === lastTree) return lastNode;
    lastTree = tree;
    lastNode = renderer.render(tree);
    return lastNode;
  };

  const handle = pumpStream(source, {
    write: (chunk) => core.write(chunk),
    end: () => core.end(),
  });

  const done = handle.done.then(
    () => undefined,
    (error: unknown) => {
      options.onError?.(error, { phase: "stream" });
      throw error;
    },
  );

  return {
    getSnapshot,
    getServerSnapshot: getSnapshot,
    subscribe: (listener) => core.subscribe(listener),
    dispose: () => handle.cancel(),
    done,
  };
}
