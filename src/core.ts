/**
 * Framework-agnostic incremental JSX parser core.
 *
 * This is the low-level, push-based entry point (`jsx-incremental-parser/core`).
 * It emits a renderer-independent AST snapshot; the React adapter (the package
 * root entry) is a thin layer on top. This module has **zero** React dependency.
 */

import { Tokenizer } from "./tokenizer";
import { TreeBuilder } from "./tree-builder";
import type { TreeBuilderOptions } from "./tree-builder";

export type { MismatchBehavior, TreeBuilderOptions } from "./tree-builder";
export { isComponentName } from "./tree-builder";

/**
 * A structured, **recoverable** JSX-level error event (PLAN.md §7), emitted
 * through `onJsxError` **as soon as the error is detected** while a chunk is
 * parsed — independent of rendering and of the configured recovery mode — so
 * a stream producer (e.g. an LLM agent) can get instant feedback while the
 * tree still recovers tolerantly. Unrecoverable stream failures are not part
 * of this union; the React adapter reports those through `onStreamError`.
 */
export type JsxErrorEvent =
  | {
      /** A closing tag that does not match the innermost open element. */
      kind: "mismatched-tag";
      /** Human-readable description (safe to feed back to an agent). */
      message: string;
      /** Name of the offending closing tag (`""` for `</>`). */
      tag: string;
      /**
       * Name of the innermost open element it was compared against (`""` for a
       * fragment), or `null` when nothing was open (a stray closing tag).
       */
      expected: string | null;
    }
  | {
      /** A component-like tag (Capitalized / dotted) that failed resolution. */
      kind: "unknown-component";
      message: string;
      /** The unresolved tag name. */
      tag: string;
    }
  | {
      /** A `{ }` expression outside the supported subset. */
      kind: "unsupported-expression";
      message: string;
      /** Raw source between the braces. */
      expression: string;
      /** Attribute name, when the expression was an attribute value. */
      attribute?: string;
    }
  | {
      /** An element still open when the stream ended (auto-closed). */
      kind: "unclosed-tag";
      message: string;
      /** Name of the element left open (`""` for a fragment). */
      tag: string;
    };

/** Listener for the unified {@link JsxErrorEvent} channel. */
export type JsxErrorListener = (event: JsxErrorEvent) => void;

/** Options for the low-level {@link createParser}. */
export type ParserOptions = TreeBuilderOptions;

/** A node in the renderer-independent AST. */
export type Node = ElementNode | FragmentNode | TextNode | ExpressionNode | PendingNode;

export interface ElementNode {
  kind: "element";
  id: number;
  tag: string;
  props: Record<string, PropValue>;
  children: Node[];
  status: "open" | "closed";
}

export interface FragmentNode {
  kind: "fragment";
  id: number;
  children: Node[];
  status: "open" | "closed";
}

export interface TextNode {
  kind: "text";
  id: number;
  value: string;
}

export interface ExpressionNode {
  kind: "expression";
  id: number;
  value: unknown;
}

/**
 * The streaming frontier (PLAN.md §1). While the stream is open there is exactly
 * one of these in the tree, placed at the cursor inside the innermost open
 * element. It disappears once the stream ends. The React adapter renders it as
 * the `<Pending />` component.
 */
export interface PendingNode {
  kind: "pending";
  id: number;
}

/** A resolved prop value (string literal, expression literal, or nested node). */
export type PropValue = string | number | boolean | null | undefined | Node;

/**
 * Sentinel stored as an {@link ExpressionNode.value} (or {@link PropValue}) when
 * an expression falls outside the supported subset (PLAN.md §2, §7). The React
 * adapter renders it as nothing; the error is reported at parse time through
 * `onJsxError` (`kind: "unsupported-expression"`).
 */
export const UNSUPPORTED_EXPRESSION: unique symbol = Symbol("unsupported-expression");

export type Listener = () => void;
export type Unsubscribe = () => void;

/** The low-level, push-based parser store. */
export interface Parser {
  /** Feed a string chunk into the parser. */
  write(chunk: string): void;
  /** Signal end of stream; drops the trailing `Pending` frontier. */
  end(): void;
  /** Current immutable AST snapshot (top-level node list). */
  getTree(): readonly Node[];
  /** Subscribe to snapshot updates; returns an unsubscribe function. */
  subscribe(listener: Listener): Unsubscribe;
}

/**
 * Create a low-level, push-based incremental JSX parser.
 *
 * Feed it with {@link Parser.write}, finish with {@link Parser.end}, and read
 * the live AST with {@link Parser.getTree}. Subscribers are notified once per
 * processed chunk (PLAN.md §4.6); {@link Parser.getTree} returns a stable
 * reference until the next change, so it is safe with `useSyncExternalStore`.
 */
export function createParser(options: ParserOptions = {}): Parser {
  const tokenizer = new Tokenizer();
  const builder = new TreeBuilder(options);
  const listeners = new Set<Listener>();

  let version = 0;
  let cachedVersion = -1;
  let cached: readonly Node[] = [];
  let ended = false;

  const notify = (): void => {
    // Deleting from a Set during iteration is safe, so a listener may
    // unsubscribe itself from within the notification.
    for (const listener of listeners) listener();
  };

  return {
    write(chunk: string): void {
      if (ended || chunk.length === 0) return;
      for (const token of tokenizer.write(chunk)) builder.push(token);
      version++;
      notify();
    },
    end(): void {
      if (ended) return;
      for (const token of tokenizer.end()) builder.push(token);
      builder.end();
      ended = true;
      version++;
      notify();
    },
    getTree(): readonly Node[] {
      if (cachedVersion !== version) {
        cached = builder.snapshot(tokenizer.getPending());
        cachedVersion = version;
      }
      return cached;
    },
    subscribe(listener: Listener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
