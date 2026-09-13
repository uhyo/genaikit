/**
 * React adapter (PLAN.md §4.5): converts the renderer-independent AST snapshot
 * into a `React.ReactNode`.
 *
 *  - intrinsic tag (lowercase) -> string type; component tag (Capitalized) ->
 *    resolved through `components` / `resolveComponent`, else handled per
 *    `onUnknownComponent`; fragment -> `React.Fragment`.
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

import { isComponentName, UNSUPPORTED_EXPRESSION } from "./core";
import type { ElementNode, Node } from "./core";

/** How to handle a component tag that cannot be resolved. */
export type UnknownComponentBehavior = "pending" | "error" | "passthrough";

export interface RenderOptions {
  /** Tag name -> React component, for Capitalized JSX names. */
  components?: Record<string, ComponentType<never>> | undefined;
  /** Placeholder rendered at the frontier (default: {@link Pending}). */
  Pending?: ComponentType<unknown> | undefined;
  /** Optional resolver, consulted before the `components` map. */
  resolveComponent?: ((name: string) => ComponentType<never> | undefined) | undefined;
  /** Behavior for an unresolved component tag (default: "pending"). */
  onUnknownComponent?: UnknownComponentBehavior | undefined;
  /** Called on a recoverable render error (e.g. unknown component in "error"). */
  onError?: ((error: unknown, info: { phase: string }) => void) | undefined;
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
      options.onError?.(new Error("Unsupported expression"), { phase: "expression" });
      return null;
    }
    if (isNode(value)) {
      // A nested JSX element/fragment used as a value.
      return renderNode(value);
    }
    return value as ReactNode;
  }

  function resolveType(tag: string): Resolved {
    if (!isComponentName(tag)) {
      return { kind: "host", tag };
    }
    const resolved = options.resolveComponent?.(tag) ?? options.components?.[tag];
    if (resolved) {
      return { kind: "component", type: resolved };
    }
    switch (behavior) {
      case "passthrough":
        return { kind: "host", tag };
      case "error":
        options.onError?.(new Error(`Unknown component <${tag}>`), { phase: "render" });
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
