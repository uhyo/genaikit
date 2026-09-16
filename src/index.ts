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

import type { ElementAllowlist, JsxErrorEvent, MismatchBehavior, Node } from "./core";
import { checkHostProp, createParser, isElementAllowed, resolveVariablePath } from "./core";
import {
  createRenderer,
  type DisallowedElementBehavior,
  type UnknownComponentBehavior,
} from "./render";
import type { JsxStreamSource } from "./stream";
import { pumpStream } from "./stream";

export type {
  Node,
  ElementNode,
  FragmentNode,
  TextNode,
  ExpressionNode,
  VariableNode,
  PendingNode,
  PropValue,
  MismatchBehavior,
  JsxErrorEvent,
  JsxErrorListener,
  SourceLocation,
} from "./core";
export {
  checkHostProp,
  formatJsxError,
  formatPromptContract,
  isElementAllowed,
  resolveVariablePath,
} from "./core";
export type { ElementAllowlist, PromptContractOptions, SchemaOptions } from "./core";
export type { JsxStreamSource } from "./stream";
export { Pending } from "./render";
export type { DisallowedElementBehavior, UnknownComponentBehavior } from "./render";

export interface IncrementalJsxParserOptions {
  /** Tag name -> React component map for capitalized JSX names. */
  components?: Record<string, ComponentType<never>>;
  /**
   * Variable name -> value, for `{name}` / `{name.member}` expressions
   * (dot notation only). Like `components`, this is the allowlist: every
   * segment of a reference is validated against these values at parse time,
   * so a path that would not resolve (unknown root name, or a member missing
   * at any depth) renders as nothing and is reported through `onJsxError`
   * (`kind: "unknown-variable"`).
   */
  variables?: Record<string, unknown>;
  /** Placeholder rendered at the streaming frontier (default: renders null). */
  Pending?: ComponentType<unknown>;
  /** Optional resolver, consulted before the `components` map. */
  resolveComponent?: (name: string) => ComponentType<never> | undefined;
  /** Behavior for an unresolved component tag (default: "pending"). */
  onUnknownComponent?: UnknownComponentBehavior;
  /**
   * Allowlist of intrinsic (lowercase) HTML elements — the schema counterpart
   * of `components`. A list of tag names, or a record mapping each allowed
   * tag to `true` (any prop) or to its allowed prop names
   * (`{ div: true, a: ["href"] }`). Absent = every intrinsic tag renders.
   * Whether or not it is set, the built-in host prop rules always apply (see
   * `checkHostProp`): string `style` values, `dangerouslySetInnerHTML` &c.,
   * non-variable `on*` handlers, and `javascript:` URLs are dropped and
   * reported (`kind: "invalid-prop"`). `formatPromptContract` serializes the
   * whole schema into a system-prompt spec for the generating model.
   */
  elements?: ElementAllowlist;
  /** Behavior for a disallowed intrinsic tag (default: "skip"). */
  onDisallowedElement?: DisallowedElementBehavior;
  /** Closing-tag mismatch recovery strategy (default: "autoclose"). */
  mismatchedTag?: MismatchBehavior;
  /**
   * The channel for **recoverable** errors: unified structured JSX-level
   * events (mismatched/unclosed tags, unknown components, unsupported
   * expressions), fired synchronously **as soon as each error is parsed** —
   * before any render, and in every `mismatchedTag` / `onUnknownComponent`
   * mode. Recovery is unaffected, so this is the channel to feed instant
   * feedback to a stream producer. Each event carries a `location`
   * (line/column + the offending line's text); `formatJsxError` renders it
   * as a ready-to-log report.
   */
  onJsxError?: (event: JsxErrorEvent) => void;
  /**
   * The channel for **unrecoverable** errors: called once if the stream
   * source fails. Parsing stops at the last good snapshot (which stays
   * rendered) and {@link IncrementalJsxParser.done} rejects with the same
   * error.
   */
  onStreamError?: (error: unknown) => void;
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
    onJsxError: options.onJsxError,
    // Only probe component resolution at parse time when someone listens, so
    // `resolveComponent` sees no extra calls otherwise.
    isKnownComponent: options.onJsxError
      ? (tag) => (options.resolveComponent?.(tag) ?? options.components?.[tag]) != null
      : undefined,
    isKnownVariable: options.onJsxError
      ? (path) => options.variables != null && resolveVariablePath(options.variables, path).found
      : undefined,
    isAllowedElement:
      options.onJsxError && options.elements
        ? (tag) => isElementAllowed(options.elements, tag)
        : undefined,
    checkProp: options.onJsxError
      ? (tag, prop, value) => checkHostProp(tag, prop, value, options)
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
      options.onStreamError?.(error);
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
