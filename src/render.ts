/**
 * React adapter (PLAN.md §4.5): converts the renderer-independent AST snapshot
 * into a `React.ReactNode`.
 *
 *  - intrinsic tag (lowercase) -> string type; component tag (Capitalized) ->
 *    resolved through `components` / `resolveComponent`, else handled per
 *    `onUnknownComponent`; fragment -> `React.Fragment`.
 *  - a variable reference -> resolved through `variables` (null-safe dot walk).
 *  - the frontier {@link PendingNode} -> the `Pending` component.
 *  - **Memoization**: every *closed* (frozen) node caches its created React
 *    element keyed by node identity, so between snapshots only the open path and
 *    the single Pending are rebuilt. Combined with stable `key`s (the node `id`)
 *    React reconciles instead of remounting as the stream grows.
 *
 * This module depends on React; the `/core` entry never imports it.
 */

import { createElement, Fragment } from "react";
import type { ComponentType, ReactNode } from "react";

import { isComponentName, resolveVariablePath, UNSUPPORTED_EXPRESSION } from "./core";
import type { ElementNode, Node, VariableNode } from "./core";
import { checkProp, isElementAllowed } from "./schema";
import type { ElementAllowlist, PropsDefinition, SchemaType } from "./schema";

/**
 * How to render a component tag that cannot be resolved. Purely a rendering
 * strategy — the unresolved tag is reported at parse time through
 * `onJsxError` (`kind: "unknown-component"`) regardless of the mode.
 */
export type UnknownComponentBehavior = "pending" | "skip" | "passthrough";

/**
 * How to render an intrinsic tag rejected by the `elements` allowlist. Purely
 * a rendering strategy — the rejection is reported at parse time through
 * `onJsxError` (`kind: "disallowed-element"`) regardless of the mode. The
 * default is `"skip"`: unlike an unknown component (which may simply not be
 * registered yet), a disallowed element is a policy rejection, and a
 * permanent `Pending` placeholder would read as "still loading".
 */
export type DisallowedElementBehavior = "skip" | "pending";

/**
 * A `components`-map entry: the component itself, or a {@link ComponentSpec}
 * that also declares the props the component accepts.
 */
export type ComponentEntry = ComponentType<never> | ComponentSpec;

/**
 * A component together with its declared prop catalog. The declaration is an
 * allowlist: a prop outside it (or with a value that fails its declared
 * {@link SchemaType}) is reported at parse time (`kind: "invalid-prop"`) and
 * dropped by the renderer.
 */
export interface ComponentSpec {
  component: ComponentType<never>;
  /** Declared prop catalog; absent = any props (the author's contract). */
  props?: PropsDefinition | undefined;
}

/** Unwrap a `components`-map entry to its component. */
export function resolveComponentEntry(
  entry: ComponentEntry | undefined,
): ComponentType<never> | undefined {
  if (entry != null && typeof entry === "object" && "component" in entry) {
    return entry.component;
  }
  // A bare component: a function, a class, or a memo/forwardRef exotic.
  return entry as ComponentType<never> | undefined;
}

export interface RenderOptions {
  /**
   * Tag name -> React component (or a {@link ComponentSpec} declaring its
   * props), for Capitalized JSX names.
   */
  components?: Record<string, ComponentEntry> | undefined;
  /** Variable name -> value, for `{name}` / `{name.member}` expressions. */
  variables?: Record<string, unknown> | undefined;
  /** Declared variable types, refining (or standing in for) the values. */
  variableTypes?: Readonly<Record<string, SchemaType>> | undefined;
  /** Placeholder rendered at the frontier (default: {@link Pending}). */
  Pending?: ComponentType<unknown> | undefined;
  /** Optional resolver, consulted before the `components` map. */
  resolveComponent?: ((name: string) => ComponentType<never> | undefined) | undefined;
  /** Rendering of an unresolved component tag (default: "pending"). */
  onUnknownComponent?: UnknownComponentBehavior | undefined;
  /** Allowlist of intrinsic tags; absent = every intrinsic tag renders. */
  elements?: ElementAllowlist | undefined;
  /** Rendering of a disallowed intrinsic tag (default: "skip"). */
  onDisallowedElement?: DisallowedElementBehavior | undefined;
}

/** Default frontier placeholder: an invisible node. */
export function Pending(): ReactNode {
  return null;
}

type Resolved =
  | { kind: "host"; tag: string }
  | { kind: "component"; type: ComponentType<never> }
  | { kind: "pending" }
  | { kind: "skip" };

/** A converter from AST snapshots to React nodes, with per-node memoization. */
export interface Renderer {
  render(nodes: readonly Node[]): ReactNode;
}

export function createRenderer(options: RenderOptions = {}): Renderer {
  // Closed nodes are frozen and reused by reference, so their rendered output is
  // stable; cache it weakly so settled subtrees are never rebuilt.
  const cache = new WeakMap<Node, ReactNode>();
  const PendingComponent = options.Pending ?? Pending;
  const behavior = options.onUnknownComponent ?? "pending";

  function render(nodes: readonly Node[]): ReactNode {
    return nodes.map(renderNode);
  }

  function renderNode(node: Node): ReactNode {
    if ((node.kind === "element" || node.kind === "fragment") && node.status === "closed") {
      const cached = cache.get(node);
      if (cached !== undefined) return cached;
      const el = create(node);
      cache.set(node, el);
      return el;
    }
    return create(node);
  }

  function create(node: Node): ReactNode {
    switch (node.kind) {
      case "text":
        return node.value;
      case "pending":
        return createElement(PendingComponent, { key: node.id });
      case "fragment":
        return createElement(Fragment, { key: node.id }, ...node.children.map(renderNode));
      case "element":
        return createElementNode(node);
      case "variable":
        return resolveVariable(node) as ReactNode;
      case "expression": {
        const value = renderValue(node.value);
        // A nested JSX value is re-keyed via a wrapper so the parent array key is
        // this expression's (unique) id, not the nested node's local id.
        return isNode(node.value) ? createElement(Fragment, { key: node.id }, value) : value;
      }
    }
  }

  function createElementNode(node: ElementNode): ReactNode {
    const resolved = resolveType(node.tag);
    if (resolved.kind === "skip") return null;
    if (resolved.kind === "pending") return createElement(PendingComponent, { key: node.id });

    const props: Record<string, unknown> = { key: node.id };
    for (const [name, value] of Object.entries(node.props)) {
      // A schema-rejected prop is dropped (already reported at parse time via
      // "invalid-prop"); left in, React would throw on e.g. string styles.
      if (checkProp(node.tag, name, value, options) !== null) continue;
      props[name] = renderValue(value);
    }
    const children = node.children.map(renderNode);
    return resolved.kind === "host"
      ? createElement(resolved.tag, props, ...children)
      : createElement(resolved.type as ComponentType<Record<string, unknown>>, props, ...children);
  }

  /** Resolve a prop value or expression value to a React-renderable value. */
  function renderValue(value: unknown): ReactNode {
    if (value === UNSUPPORTED_EXPRESSION) {
      // Already reported at parse time (onJsxError "unsupported-expression").
      return null;
    }
    if (isNode(value)) {
      // A nested JSX element/fragment used as a value.
      return renderNode(value);
    }
    return value as ReactNode;
  }

  /**
   * Walk a variable reference's dot path through the `variables` map. An
   * unresolvable path (already reported at parse time via "unknown-variable")
   * renders as `undefined` — same lookup semantics as the parse-time check.
   */
  function resolveVariable(node: VariableNode): unknown {
    const variables = options.variables;
    if (!variables) return undefined;
    const result = resolveVariablePath(variables, node.path);
    return result.found ? result.value : undefined;
  }

  function resolveType(tag: string): Resolved {
    if (!isComponentName(tag)) {
      if (!isElementAllowed(options.elements, tag)) {
        // Already reported at parse time (onJsxError "disallowed-element").
        return (options.onDisallowedElement ?? "skip") === "pending"
          ? { kind: "pending" }
          : { kind: "skip" };
      }
      return { kind: "host", tag };
    }
    const resolved =
      options.resolveComponent?.(tag) ?? resolveComponentEntry(options.components?.[tag]);
    if (resolved) {
      return { kind: "component", type: resolved };
    }
    switch (behavior) {
      case "passthrough":
        return { kind: "host", tag };
      case "skip":
        // Already reported at parse time (onJsxError "unknown-component").
        return { kind: "skip" };
      case "pending":
        return { kind: "pending" };
    }
  }

  return { render };
}

function isNode(value: unknown): value is Node {
  return value !== null && typeof value === "object" && "kind" in value;
}
