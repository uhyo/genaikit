/**
 * Tree builder & frontier model (PLAN.md §4.3–§4.4).
 *
 * Consumes the {@link Token} stream and maintains:
 *  - the committed AST (top-level node list), where every *closed* node is
 *    frozen and never mutated again (the append-only property that makes the
 *    parser incremental rather than a re-parse per chunk), and
 *  - a stack of currently open elements/fragments.
 *
 * {@link TreeBuilder.snapshot} produces the live tree by overlaying the single
 * frontier — any partial text plus one {@link PendingNode} — onto the innermost
 * open node, cloning only the open path so closed subtrees keep their identity.
 */

import type { ElementNode, FragmentNode, Node, PendingNode, PropValue, VariableNode } from "./ast";
import { isComponentName, UNSUPPORTED_EXPRESSION } from "./ast";
import type { JsxErrorListener } from "./errors";
import { parseExpression, type ParsedExpression } from "./expression";
import type { AttrValue, Pending, SourceLocation, Token } from "./tokenizer";
import { Tokenizer } from "./tokenizer";

type OpenNode = ElementNode | FragmentNode;

/**
 * How to repair the tree when a closing tag does not match the innermost open
 * element. Purely a recovery strategy — the mismatch is always reported
 * through {@link TreeBuilderOptions.onJsxError} regardless of the mode.
 */
export type MismatchBehavior = "autoclose" | "ignore";

/**
 * The probes below are only consulted when `onJsxError` is set; none of them
 * affects recovery or rendering.
 */
export interface TreeBuilderOptions {
  /** Closing-tag mismatch recovery strategy (default: "autoclose"). */
  mismatchedTag?: MismatchBehavior | undefined;
  /**
   * The unified structured error channel: called synchronously, at parse time,
   * for every JSX-level error — whatever recovery mode is configured.
   */
  onJsxError?: JsxErrorListener | undefined;
  /**
   * Opening a component-like tag (see `isComponentName`) this rejects emits
   * an `"unknown-component"` event.
   */
  isKnownComponent?: ((tag: string) => boolean) | undefined;
  /**
   * A variable reference whose dot path this rejects emits an
   * `"unknown-variable"` event. It receives the full path, so it may validate
   * the root name only or every segment (see `resolveVariablePath`).
   */
  isKnownVariable?: ((path: readonly string[]) => boolean) | undefined;
  /**
   * Opening an intrinsic (non-component) tag this rejects emits a
   * `"disallowed-element"` event (see `isElementAllowed`).
   */
  isAllowedElement?: ((tag: string) => boolean) | undefined;
  /**
   * Probed for every prop when an opening tag completes: a non-`null` return
   * is the rejection reason and emits an `"invalid-prop"` event (see
   * `checkProp`, which the renderer applies to drop the prop).
   */
  checkProp?: ((tag: string, prop: string, value: PropValue) => string | null) | undefined;
}

/** Only one frontier marker exists at a time, so its key is fixed. */
const PENDING_ID = -1;
/** Wraps multiple top-level nodes of nested JSX; ids there are local anyway. */
const NESTED_FRAGMENT_ID = -2;

/** An opening tag being assembled between `openTagStart` and its `>`. */
interface Building {
  name: string;
  props: Record<string, PropValue>;
  loc: SourceLocation;
}

/** An open node plus its opening-tag location (for error events). */
interface OpenEntry {
  node: OpenNode;
  loc: SourceLocation;
}

export class TreeBuilder {
  private readonly options: TreeBuilderOptions;
  private readonly onJsxError: JsxErrorListener | undefined;
  private readonly mismatchedTag: MismatchBehavior;

  private nextId = 0;
  /** Committed top-level nodes (the open path is mutated in place). */
  private readonly roots: Node[] = [];
  /** Outermost first; the last is the frontier's parent. */
  private readonly openStack: OpenEntry[] = [];
  private building: Building | null = null;
  /** Id reserved for the in-progress text run, kept when it commits. */
  private currentTextId: number | null = null;
  private ended = false;

  constructor(options: TreeBuilderOptions = {}) {
    this.options = options;
    this.onJsxError = options.onJsxError;
    this.mismatchedTag = options.mismatchedTag ?? "autoclose";
  }

  /** Apply one completed token to the committed tree. */
  push(token: Token): void {
    switch (token.type) {
      case "openTagStart": {
        this.building = { name: token.name, props: {}, loc: token.loc };
        return;
      }
      case "attribute": {
        if (this.building) {
          this.building.props[token.name] = this.attrToProp(token.name, token.value);
        }
        return;
      }
      case "openTagEnd": {
        const entry = this.completeOpeningTag(token.loc);
        if (entry) {
          this.appendChild(entry.node);
          this.openStack.push(entry);
        }
        return;
      }
      case "selfClose": {
        const entry = this.completeOpeningTag(token.loc);
        if (entry) {
          entry.node.status = "closed";
          this.appendChild(freeze(entry.node));
        }
        return;
      }
      case "closeTag": {
        this.closeTag(token.name, token.loc);
        return;
      }
      case "text": {
        const id = this.currentTextId ?? this.nextId++;
        this.currentTextId = null;
        this.appendChild(freeze({ kind: "text", id, value: token.value }));
        return;
      }
      case "expr": {
        const value = this.parseExpr(token.raw, token.loc);
        this.appendChild(freeze({ kind: "expression", id: this.nextId++, value }));
        return;
      }
    }
  }

  /**
   * Finalize the stream: close any still-open nodes and drop the frontier.
   * Each auto-closed node is reported as an `"unclosed-tag"` event, innermost
   * first.
   */
  end(): void {
    while (this.openStack.length > 0) {
      const { node, loc } = this.openStack[this.openStack.length - 1]!;
      const name = nodeName(node);
      this.onJsxError?.({
        kind: "unclosed-tag",
        message:
          name === ""
            ? "Unclosed fragment <> at end of input"
            : `Unclosed tag <${name}> at end of input`,
        tag: name,
        location: loc,
      });
      this.closeTop();
    }
    this.building = null;
    this.ended = true;
  }

  /**
   * The live tree: committed nodes plus the frontier (partial text + a single
   * {@link PendingNode}) while the stream is open. After {@link end} the
   * committed roots are returned directly.
   */
  snapshot(pending: Pending): readonly Node[] {
    if (this.ended) return this.roots;

    const frontier: Node[] = [];
    if (pending.type === "text") {
      this.currentTextId ??= this.nextId++;
      frontier.push({ kind: "text", id: this.currentTextId, value: pending.value });
    }
    const pendingNode: PendingNode = { kind: "pending", id: PENDING_ID };
    frontier.push(pendingNode);

    const stack = this.openStack;
    if (stack.length === 0) return [...this.roots, ...frontier];

    // Clone the open path bottom-up; each parent's last child is the open
    // node below it, and stack[0] is the last root.
    const deepest = stack[stack.length - 1]!.node;
    let child: OpenNode = { ...deepest, children: [...deepest.children, ...frontier] };
    for (let i = stack.length - 2; i >= 0; i--) {
      const parent = stack[i]!.node;
      child = { ...parent, children: [...parent.children.slice(0, -1), child] };
    }
    return [...this.roots.slice(0, -1), child];
  }

  private attrToProp(name: string, value: AttrValue): PropValue {
    switch (value.type) {
      case "string":
        return value.value;
      case "boolean":
        return true;
      case "expression":
        // UNSUPPORTED_EXPRESSION is kept as a prop value; the renderer drops it.
        return this.parseExpr(value.raw, value.loc, name) as PropValue;
    }
  }

  /** Parse a `{ }` expression, reporting an unsupported one. */
  private parseExpr(raw: string, loc: SourceLocation, attribute?: string): ParsedExpression {
    const value = parseExpression(
      raw,
      (src) => this.parseJsx(src, loc),
      (path) => this.createVariable(path, loc),
    );
    if (value === UNSUPPORTED_EXPRESSION) {
      this.onJsxError?.({
        kind: "unsupported-expression",
        message:
          attribute === undefined
            ? `Unsupported expression: {${raw}}`
            : `Unsupported expression in attribute "${attribute}": {${raw}}`,
        expression: raw,
        ...(attribute !== undefined && { attribute }),
        location: loc,
      });
    }
    return value;
  }

  private createVariable(rawPath: readonly string[], loc: SourceLocation): VariableNode {
    const path = Object.freeze(rawPath);
    const { isKnownVariable } = this.options;
    if (this.onJsxError && isKnownVariable && !isKnownVariable(path)) {
      this.onJsxError({
        kind: "unknown-variable",
        message: `Unknown variable reference {${path.join(".")}}`,
        name: path[0]!,
        path,
        location: loc,
      });
    }
    return freeze({ kind: "variable", id: this.nextId++, path });
  }

  /** Parse nested JSX from an expression with a fresh, self-contained parse. */
  private parseJsx(src: string, loc: SourceLocation): Node | undefined {
    const tokenizer = new Tokenizer();
    const onJsxError = this.onJsxError;
    // Positions inside the buffered expression are relative to its own
    // source, so nested events are reported at the enclosing `{` instead.
    const builder = new TreeBuilder({
      ...this.options,
      mismatchedTag: undefined,
      onJsxError: onJsxError && ((event) => onJsxError({ ...event, location: loc })),
    });
    for (const token of tokenizer.write(src)) builder.push(token);
    for (const token of tokenizer.end()) builder.push(token);
    builder.end();
    const nodes = builder.snapshot({ type: "none" });
    if (nodes.length <= 1) return nodes[0];
    return freeze({
      kind: "fragment",
      id: NESTED_FRAGMENT_ID,
      children: [...nodes],
      status: "closed",
    });
  }

  /** Complete the opening tag being assembled; `end` is the location of its `>`. */
  private completeOpeningTag(end: SourceLocation): OpenEntry | null {
    const building = this.building;
    this.building = null;
    if (!building) return null;

    // When the tag ends on the line it started, that line has streamed further
    // since `openTagStart`: adopt the fuller text so error frames show the
    // whole opening tag.
    let loc = building.loc;
    if (end.line === loc.line && end.lineText.length > loc.lineText.length) {
      loc = { ...loc, lineText: end.lineText };
    }

    const id = this.nextId++;
    if (building.name === "") {
      return { node: { kind: "fragment", id, children: [], status: "open" }, loc };
    }
    if (this.onJsxError) this.validateOpeningTag(building.name, building.props, loc);
    const node: ElementNode = {
      kind: "element",
      id,
      tag: building.name,
      props: Object.freeze(building.props),
      children: [],
      status: "open",
    };
    return { node, loc };
  }

  private validateOpeningTag(
    name: string,
    props: Record<string, PropValue>,
    loc: SourceLocation,
  ): void {
    const { isKnownComponent, isAllowedElement, checkProp } = this.options;
    if (isComponentName(name)) {
      if (isKnownComponent && !isKnownComponent(name)) {
        this.onJsxError?.({
          kind: "unknown-component",
          message: `Unknown component <${name}>`,
          tag: name,
          location: loc,
        });
      }
    } else if (isAllowedElement && !isAllowedElement(name)) {
      this.onJsxError?.({
        kind: "disallowed-element",
        message: `Disallowed element <${name}>`,
        tag: name,
        location: loc,
      });
    }
    if (!checkProp) return;
    for (const [prop, value] of Object.entries(props)) {
      const reason = checkProp(name, prop, value);
      if (reason !== null) {
        this.onJsxError?.({
          kind: "invalid-prop",
          message: `Invalid prop "${prop}" on <${name}>: ${reason}`,
          tag: name,
          prop,
          reason,
          location: loc,
        });
      }
    }
  }

  /**
   * Handle a closing tag, honoring the {@link MismatchBehavior} when it does not
   * match the innermost open element (PLAN.md §7).
   */
  private closeTag(name: string, loc: SourceLocation): void {
    const stack = this.openStack;
    if (stack.length === 0) {
      this.onJsxError?.({
        kind: "mismatched-tag",
        message: `Stray closing tag </${name}> with nothing open`,
        tag: name,
        expected: null,
        location: loc,
      });
      return;
    }

    const expected = nodeName(stack[stack.length - 1]!.node);
    if (expected === name) {
      this.closeTop();
      return;
    }

    this.onJsxError?.({
      kind: "mismatched-tag",
      message: `Mismatched closing tag </${name}>; expected </${expected}>`,
      tag: name,
      expected,
      location: loc,
    });
    if (this.mismatchedTag === "autoclose") {
      // Close down to a matching ancestor if there is one; otherwise treat the
      // tag as closing the innermost element.
      const matchIndex = stack.findLastIndex((entry) => nodeName(entry.node) === name);
      const target = matchIndex >= 0 ? matchIndex : stack.length - 1;
      while (stack.length > target) this.closeTop();
    }
  }

  /** Pop and freeze the innermost open node. */
  private closeTop(): void {
    const entry = this.openStack.pop();
    if (!entry) return;
    entry.node.status = "closed";
    freeze(entry.node);
  }

  private appendChild(node: Node): void {
    const parent = this.openStack[this.openStack.length - 1];
    if (parent) {
      parent.node.children.push(node);
    } else {
      this.roots.push(node);
    }
  }
}

function nodeName(node: OpenNode): string {
  return node.kind === "fragment" ? "" : node.tag;
}

function freeze<T extends Node>(node: T): T {
  if (node.kind === "element" || node.kind === "fragment") {
    Object.freeze(node.children);
  }
  return Object.freeze(node);
}
