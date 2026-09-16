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

import type {
  ElementNode,
  ExpressionNode,
  FragmentNode,
  JsxErrorListener,
  Node,
  PendingNode,
  PropValue,
  TextNode,
  VariableNode,
} from "./core";
import { UNSUPPORTED_EXPRESSION } from "./core";
import { parseExpression, type ParsedExpression } from "./expression";
import type { AttrValue, Partial, SourceLocation, Token } from "./tokenizer";
import { Tokenizer } from "./tokenizer";

/** A node that can still receive children (sits on the open stack). */
type OpenNode = ElementNode | FragmentNode;

/**
 * How to repair the tree when a closing tag does not match the innermost open
 * element. Purely a recovery strategy — the mismatch is always reported
 * through {@link TreeBuilderOptions.onJsxError} regardless of the mode.
 */
export type MismatchBehavior = "autoclose" | "ignore";

/** Whether a tag name resolves as a component (Capitalized or `Foo.Bar`). */
export function isComponentName(tag: string): boolean {
  const first = tag.charCodeAt(0);
  return (first >= 65 && first <= 90) || tag.includes(".");
}

export interface TreeBuilderOptions {
  /** Closing-tag mismatch recovery strategy (default: "autoclose"). */
  mismatchedTag?: MismatchBehavior | undefined;
  /**
   * The unified structured error channel: called synchronously, at parse time,
   * for every JSX-level error — whatever recovery mode is configured.
   * Reporting is decoupled from recovery: the tree is still repaired
   * tolerantly.
   */
  onJsxError?: JsxErrorListener | undefined;
  /**
   * Optional resolver check: when provided, opening a component-like tag
   * (see {@link isComponentName}) it does not recognize emits an
   * `"unknown-component"` event. Recovery/rendering is unaffected.
   */
  isKnownComponent?: ((tag: string) => boolean) | undefined;
  /**
   * Optional resolver check: when provided, a variable reference expression
   * (`{foo}` / `{foo.bar}`) it rejects emits an `"unknown-variable"` event.
   * It receives the full dot path, so it may validate at any depth — root
   * name only (`path[0]`), or every segment (see `resolveVariablePath`).
   * Recovery/rendering is unaffected.
   */
  isKnownVariable?: ((path: readonly string[]) => boolean) | undefined;
  /**
   * Optional allowlist check: when provided, opening an intrinsic
   * (non-component) tag it rejects emits a `"disallowed-element"` event.
   * Recovery/rendering is unaffected (see `isElementAllowed`).
   */
  isAllowedElement?: ((tag: string) => boolean) | undefined;
  /**
   * Optional prop check, probed for every prop when the opening tag
   * completes: a non-`null` return is the human-readable rejection reason and
   * emits an `"invalid-prop"` event. Recovery/rendering is unaffected — the
   * renderer applies the same check to drop the prop (see `checkHostProp`).
   */
  checkProp?: ((tag: string, prop: string, value: PropValue) => string | null) | undefined;
}

/** The single frontier marker has a fixed key (only ever one exists at a time). */
const PENDING_ID = -1;

/** An opening tag being assembled between `openTagStart` and `openTagEnd`. */
interface Building {
  name: string;
  props: Record<string, PropValue>;
  /** Where the opening tag starts, for error events about this element. */
  loc: SourceLocation;
}

export class TreeBuilder {
  private readonly mismatchedTag: MismatchBehavior;
  private readonly onJsxError: JsxErrorListener | undefined;
  private readonly isKnownComponent: ((tag: string) => boolean) | undefined;
  private readonly isKnownVariable: ((path: readonly string[]) => boolean) | undefined;
  private readonly isAllowedElement: ((tag: string) => boolean) | undefined;
  private readonly checkProp:
    | ((tag: string, prop: string, value: PropValue) => string | null)
    | undefined;

  constructor(options: TreeBuilderOptions = {}) {
    this.mismatchedTag = options.mismatchedTag ?? "autoclose";
    this.onJsxError = options.onJsxError;
    this.isKnownComponent = options.isKnownComponent;
    this.isKnownVariable = options.isKnownVariable;
    this.isAllowedElement = options.isAllowedElement;
    this.checkProp = options.checkProp;
  }

  private nextId = 0;
  /** Committed top-level nodes (append-only; the open path is mutated in place). */
  private readonly roots: Node[] = [];
  /** Currently open nodes, outermost first; the last is the frontier's parent. */
  private readonly openStack: OpenNode[] = [];
  /** Opening-tag location of each entry in {@link openStack} (kept in sync). */
  private readonly openLocs: SourceLocation[] = [];
  /** The opening tag currently being assembled, if any. */
  private building: Building | null = null;
  /** Stable id reserved for the in-progress text run (shared with its commit). */
  private currentTextId: number | null = null;
  private ended = false;

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
        this.refreshBuildingLine(token.loc);
        const loc = this.building?.loc;
        const node = this.createOpenNode();
        if (node && loc) {
          this.appendChild(node);
          this.openStack.push(node);
          this.openLocs.push(loc);
        }
        this.building = null;
        return;
      }
      case "selfClose": {
        this.refreshBuildingLine(token.loc);
        const node = this.createOpenNode();
        if (node) {
          node.status = "closed";
          this.appendChild(node);
          freeze(node);
        }
        this.building = null;
        return;
      }
      case "closeTag": {
        this.closeTag(token.name, token.loc);
        return;
      }
      case "text": {
        const id = this.currentTextId ?? this.nextId++;
        this.currentTextId = null;
        const node: TextNode = { kind: "text", id, value: token.value };
        this.appendChild(freeze(node));
        return;
      }
      case "expr": {
        const value = this.parseExpr(token.raw, token.loc);
        const node: ExpressionNode = { kind: "expression", id: this.nextId++, value };
        this.appendChild(freeze(node));
        return;
      }
    }
  }

  /**
   * When the `>` / `/>` ends the tag on the same line it started, the line has
   * streamed further since `openTagStart` was captured — adopt the fuller line
   * text so error frames about this element show the whole opening tag.
   */
  private refreshBuildingLine(end: SourceLocation): void {
    const building = this.building;
    if (
      building &&
      end.line === building.loc.line &&
      end.lineText.length > building.loc.lineText.length
    ) {
      building.loc = { ...building.loc, lineText: end.lineText };
    }
  }

  private attrToProp(name: string, value: AttrValue): PropValue {
    switch (value.type) {
      case "string":
        return value.value;
      case "boolean":
        return true;
      case "expression":
        // The sentinel for an unsupported expression is detected by the adapter.
        return this.parseExpr(value.raw, value.loc, name) as PropValue;
    }
  }

  /** Parse a `{ }` expression, reporting an unsupported one as it is detected. */
  private parseExpr(raw: string, loc: SourceLocation, attribute?: string): ParsedExpression {
    const value = parseExpression(
      raw,
      (src) => this.parseJsx(src, loc),
      (path) => this.createVariable(path, loc),
    );
    if (value === UNSUPPORTED_EXPRESSION && this.onJsxError) {
      this.onJsxError(
        attribute === undefined
          ? {
              kind: "unsupported-expression",
              message: `Unsupported expression: {${raw}}`,
              expression: raw,
              location: loc,
            }
          : {
              kind: "unsupported-expression",
              message: `Unsupported expression in attribute "${attribute}": {${raw}}`,
              expression: raw,
              attribute,
              location: loc,
            },
      );
    }
    return value;
  }

  /** Materialize a variable reference node, reporting a rejected path. */
  private createVariable(rawPath: readonly string[], loc: SourceLocation): VariableNode {
    const path = Object.freeze(rawPath);
    if (this.onJsxError && this.isKnownVariable && !this.isKnownVariable(path)) {
      this.onJsxError({
        kind: "unknown-variable",
        message: `Unknown variable reference {${path.join(".")}}`,
        name: path[0]!,
        path,
        location: loc,
      });
    }
    const node: VariableNode = { kind: "variable", id: this.nextId++, path };
    return freeze(node);
  }

  /** Parse a nested JSX expression by running a fresh, self-contained parse. */
  private parseJsx(src: string, loc: SourceLocation): Node | undefined {
    const tokenizer = new Tokenizer();
    const onJsxError = this.onJsxError;
    // Nested JSX keeps the default recovery (unchanged behavior), but its
    // errors still surface through the unified event channel. Positions inside
    // the buffered expression are relative to its own source, so nested events
    // are reported at the enclosing `{` in the outer stream instead.
    const builder = new TreeBuilder({
      onJsxError: onJsxError && ((event) => onJsxError({ ...event, location: loc })),
      isKnownComponent: this.isKnownComponent,
      isKnownVariable: this.isKnownVariable,
      isAllowedElement: this.isAllowedElement,
      checkProp: this.checkProp,
    });
    for (const token of tokenizer.write(src)) builder.push(token);
    for (const token of tokenizer.end()) builder.push(token);
    builder.end();
    const nodes = builder.snapshot({ type: "none" });
    if (nodes.length === 0) return undefined;
    if (nodes.length === 1) return nodes[0];
    const fragment: FragmentNode = {
      kind: "fragment",
      id: -2,
      children: [...nodes],
      status: "closed",
    };
    return freeze(fragment);
  }

  /**
   * Finalize the stream: close any still-open nodes (best-effort; richer
   * recovery arrives in Phase 7) and drop the frontier. Each auto-closed node
   * is reported as an `"unclosed-tag"` event, innermost first.
   */
  end(): void {
    while (this.openStack.length > 0) {
      const name = nodeName(this.openStack[this.openStack.length - 1]!);
      this.onJsxError?.({
        kind: "unclosed-tag",
        message:
          name === ""
            ? "Unclosed fragment <> at end of input"
            : `Unclosed tag <${name}> at end of input`,
        tag: name,
        location: this.openLocs[this.openLocs.length - 1]!,
      });
      this.closeTop();
    }
    this.building = null;
    this.ended = true;
  }

  /**
   * The live tree: committed nodes plus the frontier (partial text + a single
   * {@link PendingNode}) while the stream is open. After {@link end} the
   * frontier is gone and the committed roots are returned directly.
   */
  snapshot(pending: Partial): readonly Node[] {
    if (this.ended) return this.roots;

    const extras: Node[] = [];
    if (pending.type === "text") {
      this.currentTextId ??= this.nextId++;
      const textNode: TextNode = { kind: "text", id: this.currentTextId, value: pending.value };
      extras.push(textNode);
    }
    const pendingNode: PendingNode = { kind: "pending", id: PENDING_ID };
    extras.push(pendingNode);

    return this.withFrontier(extras);
  }

  private createOpenNode(): OpenNode | null {
    const building = this.building;
    if (!building) return null;
    const id = this.nextId++;
    if (building.name === "") {
      return { kind: "fragment", id, children: [], status: "open" };
    }
    if (
      this.onJsxError &&
      this.isKnownComponent &&
      isComponentName(building.name) &&
      !this.isKnownComponent(building.name)
    ) {
      this.onJsxError({
        kind: "unknown-component",
        message: `Unknown component <${building.name}>`,
        tag: building.name,
        location: building.loc,
      });
    }
    if (
      this.onJsxError &&
      this.isAllowedElement &&
      !isComponentName(building.name) &&
      !this.isAllowedElement(building.name)
    ) {
      this.onJsxError({
        kind: "disallowed-element",
        message: `Disallowed element <${building.name}>`,
        tag: building.name,
        location: building.loc,
      });
    }
    if (this.onJsxError && this.checkProp) {
      for (const [prop, value] of Object.entries(building.props)) {
        const reason = this.checkProp(building.name, prop, value);
        if (reason !== null) {
          this.onJsxError({
            kind: "invalid-prop",
            message: `Invalid prop "${prop}" on <${building.name}>: ${reason}`,
            tag: building.name,
            prop,
            reason,
            location: building.loc,
          });
        }
      }
    }
    return {
      kind: "element",
      id,
      tag: building.name,
      props: Object.freeze(building.props),
      children: [],
      status: "open",
    };
  }

  /**
   * Handle a closing tag, honoring the {@link MismatchBehavior} when it does not
   * match the innermost open element (PLAN.md §7).
   */
  private closeTag(name: string, loc: SourceLocation): void {
    const stack = this.openStack;
    if (stack.length === 0) {
      // Stray close with nothing open: report it, then ignore it (unchanged).
      this.onJsxError?.({
        kind: "mismatched-tag",
        message: `Stray closing tag </${name}> with nothing open`,
        tag: name,
        expected: null,
        location: loc,
      });
      return;
    }

    const top = stack[stack.length - 1]!;
    const expected = nodeName(top);
    if (expected === name) {
      this.closeTop();
      return;
    }

    // The innermost element does not match `name`. Report first — the event
    // fires in every recovery mode — then recover per `mismatchedTag`.
    this.onJsxError?.({
      kind: "mismatched-tag",
      message: `Mismatched closing tag </${name}>; expected </${expected}>`,
      tag: name,
      expected,
      location: loc,
    });
    switch (this.mismatchedTag) {
      case "ignore":
        return;
      case "autoclose": {
        // Close down to a matching ancestor if there is one; otherwise treat the
        // mismatched tag as closing the innermost element (best-effort).
        const matchIndex = findMatch(stack, name);
        const target = matchIndex >= 0 ? matchIndex : stack.length - 1;
        while (stack.length > target) this.closeTop();
        return;
      }
    }
  }

  /** Pop and freeze the innermost open node. */
  private closeTop(): void {
    const node = this.openStack.pop();
    this.openLocs.pop();
    if (!node) return;
    node.status = "closed";
    freeze(node);
  }

  /** Append a node to the innermost open node, or to the root list. */
  private appendChild(node: Node): void {
    const parent = this.openStack[this.openStack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      this.roots.push(node);
    }
  }

  /** Clone the open path so `extras` can be appended without mutating the tree. */
  private withFrontier(extras: Node[]): readonly Node[] {
    const stack = this.openStack;
    if (stack.length === 0) {
      return extras.length > 0 ? [...this.roots, ...extras] : this.roots;
    }

    // Deepest open node: clone with its committed children + the frontier.
    let child: OpenNode = cloneOpen(stack[stack.length - 1]!, [
      ...stack[stack.length - 1]!.children,
      ...extras,
    ]);
    // Walk up: each parent's last child is the open node we just cloned.
    for (let i = stack.length - 2; i >= 0; i--) {
      const parent = stack[i]!;
      const children = parent.children.slice(0, -1);
      children.push(child);
      child = cloneOpen(parent, children);
    }
    // stack[0] is the last committed root; replace it with the cloned path.
    return [...this.roots.slice(0, -1), child];
  }
}

function nodeName(node: OpenNode): string {
  return node.kind === "fragment" ? "" : node.tag;
}

/** Index of the topmost open node matching `name`, or -1. */
function findMatch(stack: readonly OpenNode[], name: string): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (nodeName(stack[i]!) === name) return i;
  }
  return -1;
}

function cloneOpen(node: OpenNode, children: Node[]): OpenNode {
  if (node.kind === "fragment") {
    return { kind: "fragment", id: node.id, children, status: node.status };
  }
  return {
    kind: "element",
    id: node.id,
    tag: node.tag,
    props: node.props,
    children,
    status: node.status,
  };
}

function freeze<T extends Node>(node: T): T {
  if (node.kind === "element" || node.kind === "fragment") {
    Object.freeze(node.children);
  }
  return Object.freeze(node);
}
