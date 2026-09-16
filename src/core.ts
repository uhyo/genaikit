/**
 * Framework-agnostic incremental JSX parser core.
 *
 * This is the low-level, push-based entry point (`jsx-incremental-parser/core`).
 * It emits a renderer-independent AST snapshot; the React adapter (the package
 * root entry) is a thin layer on top. This module has **zero** React dependency.
 */

import { Tokenizer } from "./tokenizer";
import type { SourceLocation } from "./tokenizer";
import { TreeBuilder } from "./tree-builder";
import type { TreeBuilderOptions } from "./tree-builder";

export type { MismatchBehavior, TreeBuilderOptions } from "./tree-builder";
export { isComponentName } from "./tree-builder";
export type { SourceLocation } from "./tokenizer";
export { checkHostProp, formatPromptContract, isElementAllowed } from "./schema";
export type { ElementAllowlist, PromptContractOptions, SchemaOptions } from "./schema";

/**
 * A structured, **recoverable** JSX-level error event (PLAN.md §7), emitted
 * through `onJsxError` **as soon as the error is detected** while a chunk is
 * parsed — independent of rendering and of the configured recovery mode — so
 * a stream producer (e.g. an LLM agent) can get instant feedback while the
 * tree still recovers tolerantly. Unrecoverable stream failures are not part
 * of this union; the React adapter reports those through `onStreamError`.
 *
 * Every variant carries a {@link SourceLocation} pointing at the offending
 * construct; {@link formatJsxError} renders `message` + location + the source
 * line with a caret into one report string.
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
      /** Where the offending closing tag starts (its `<`). */
      location: SourceLocation;
    }
  | {
      /** A component-like tag (Capitalized / dotted) that failed resolution. */
      kind: "unknown-component";
      message: string;
      /** The unresolved tag name. */
      tag: string;
      /** Where the unresolved tag starts (its `<`). */
      location: SourceLocation;
    }
  | {
      /** A `{ }` variable reference rejected by the `isKnownVariable` probe. */
      kind: "unknown-variable";
      message: string;
      /** The root identifier of the reference. */
      name: string;
      /** The full dot-notation path (`{a.b.c}` → `["a","b","c"]`). */
      path: readonly string[];
      /** Where the expression starts (its `{`). */
      location: SourceLocation;
    }
  | {
      /** A `{ }` expression outside the supported subset. */
      kind: "unsupported-expression";
      message: string;
      /** Raw source between the braces. */
      expression: string;
      /** Attribute name, when the expression was an attribute value. */
      attribute?: string;
      /** Where the expression starts (its `{`). */
      location: SourceLocation;
    }
  | {
      /** An element still open when the stream ended (auto-closed). */
      kind: "unclosed-tag";
      message: string;
      /** Name of the element left open (`""` for a fragment). */
      tag: string;
      /** Where the unclosed element was opened (its `<`). */
      location: SourceLocation;
    }
  | {
      /** An intrinsic (lowercase) tag rejected by the element allowlist. */
      kind: "disallowed-element";
      message: string;
      /** The rejected tag name. */
      tag: string;
      /** Where the rejected tag starts (its `<`). */
      location: SourceLocation;
    }
  | {
      /**
       * A prop on an intrinsic element rejected by the schema (per-tag
       * allowlist or the built-in host prop rules); the renderer drops it.
       */
      kind: "invalid-prop";
      message: string;
      /** Tag the prop appeared on. */
      tag: string;
      /** The rejected prop name. */
      prop: string;
      /** Why it was rejected (as returned by `checkHostProp`). */
      reason: string;
      /** Where the owning element's opening tag starts (its `<`). */
      location: SourceLocation;
    };

/** Listener for the unified {@link JsxErrorEvent} channel. */
export type JsxErrorListener = (event: JsxErrorEvent) => void;

/** Widest code frame rendered by {@link formatJsxError} before windowing. */
const MAX_FRAME_WIDTH = 80;

/**
 * Render a {@link JsxErrorEvent} as a multi-line report: the `message`, the
 * line/column, and the source line with a caret under the offending column —
 * ready to log or to feed back to the agent producing the stream.
 *
 * ```text
 * Mismatched closing tag </b>; expected </a> (line 2, column 8)
 *
 *   2 |   hello</b>
 *     |        ^
 * ```
 *
 * `lineText` holds the line as far as it had streamed when the error was
 * captured, so the frame may end at the error itself. Long lines are windowed
 * around the caret; leading tabs are preserved so the caret stays aligned.
 */
export function formatJsxError(event: JsxErrorEvent): string {
  const { line, column, lineText } = event.location;
  const header = `${event.message} (line ${line}, column ${column})`;

  let text = lineText;
  // Clamp the caret into the captured text (the line may have been truncated).
  let caret = Math.min(Math.max(column, 1), text.length + 1);
  if (text.length > MAX_FRAME_WIDTH) {
    const start = Math.max(
      0,
      Math.min(caret - 1 - Math.floor(MAX_FRAME_WIDTH / 2), text.length - MAX_FRAME_WIDTH),
    );
    const end = start + MAX_FRAME_WIDTH;
    const head = start > 0 ? "…" : "";
    const tail = end < text.length ? "…" : "";
    text = head + text.slice(start, end) + tail;
    caret = caret - start + head.length;
  }
  // Mirror the line's own tabs in the caret padding so alignment survives them.
  const padding = text.slice(0, caret - 1).replace(/[^\t]/g, " ");
  const gutter = String(line);
  return `${header}\n\n  ${gutter} | ${text}\n  ${" ".repeat(gutter.length)} | ${padding}^`;
}

/** Options for the low-level {@link createParser}. */
export type ParserOptions = TreeBuilderOptions;

/** A node in the renderer-independent AST. */
export type Node =
  | ElementNode
  | FragmentNode
  | TextNode
  | ExpressionNode
  | VariableNode
  | PendingNode;

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
 * A variable reference expression (`{foo}` / `{foo.bar.baz}`). The core only
 * records the dot-notation path; resolution happens at render time against a
 * consumer-supplied `variables` map (mirroring how component tags resolve
 * through `components`). It appears as an {@link ExpressionNode} value (child
 * position) or directly as a {@link PropValue} (attribute position).
 */
export interface VariableNode {
  kind: "variable";
  id: number;
  /** Root identifier followed by its member accesses (`a.b.c` → `["a","b","c"]`). */
  path: readonly string[];
}

/**
 * Path segments that would escape the predefined data (prototype access, the
 * `Function` constructor). The expression parser excludes them from the
 * supported subset at any position — such a reference is
 * `UNSUPPORTED_EXPRESSION` and never reaches the AST — and
 * {@link resolveVariablePath} refuses them too, as defense in depth.
 */
export const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * Resolve a {@link VariableNode} dot path against a `variables` map — the one
 * canonical lookup, shared by parse-time validation (`isKnownVariable`) and
 * render-time resolution so the two can never disagree.
 *
 * The root name must be an **own** property of the map (inherited
 * `Object.prototype` members like `toString` are never "predefined"). Each
 * member must be present on the previous value (`in`, prototype chain
 * included; primitives are boxed, so `title.length` resolves on a string),
 * except the {@link FORBIDDEN_SEGMENTS}, which are always refused. A missing
 * name/member or a member on `null`/`undefined` is `{ found: false }`.
 * `found: true` still covers a `null`/`undefined` *value* — the path itself is
 * valid.
 */
export function resolveVariablePath(
  variables: Record<string, unknown>,
  path: readonly string[],
): { found: true; value: unknown } | { found: false } {
  const [name, ...members] = path;
  if (name === undefined || FORBIDDEN_SEGMENTS.has(name) || !Object.hasOwn(variables, name)) {
    return { found: false };
  }
  let value: unknown = variables[name];
  for (const key of members) {
    if (FORBIDDEN_SEGMENTS.has(key) || value == null || !(key in Object(value))) {
      return { found: false };
    }
    value = (value as Record<string, unknown>)[key];
  }
  return { found: true, value };
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
