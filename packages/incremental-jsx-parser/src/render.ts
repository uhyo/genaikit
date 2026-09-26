/**
 * React adapter (PLAN.md §4.5): converts the renderer-independent AST snapshot
 * into a `React.ReactNode`.
 *
 * Every *closed* (frozen) node caches its created React element keyed by node
 * identity, so between snapshots only the open path and the single Pending are
 * rebuilt. Combined with stable `key`s (the node `id`), React reconciles
 * instead of remounting as the stream grows.
 *
 * This module depends on React; the `/core` entry never imports it.
 */

import { createContext, createElement, Fragment, useContext } from "react";
import type { ComponentType, ReactNode } from "react";

import { isComponentName, resolveVariablePath, UNSUPPORTED_EXPRESSION } from "./ast";
import type { ElementNode, Node } from "./ast";
import { checkProp, isComponentSpec, isElementAllowed } from "./schema";
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
  /** May be omitted when the component is supplied by `resolveComponent`. */
  component?: ComponentType<never> | undefined;
  /** Declared prop catalog; absent = any props (the author's contract). */
  props?: PropsDefinition | undefined;
}

/** Unwrap a `components`-map entry to its component. */
export function resolveComponentEntry(
  entry: ComponentEntry | undefined,
): ComponentType<never> | undefined {
  return isComponentSpec(entry) ? (entry as ComponentSpec).component : entry;
}

export interface RenderOptions {
  /**
   * Tag name -> React component map for capitalized JSX names — the
   * **component catalog**. An entry is either the component itself, or a
   * `{ component, props }` spec that also declares the props the component
   * accepts: prop names (`["title"]`), or prop name -> `SchemaType`
   * (`{ title: "string", onAction: "function" }`). With a declaration, every
   * prop parsed on that component is validated against it — an unknown prop
   * or a value failing its declared type is reported (`kind: "invalid-prop"`)
   * and dropped. Without one, props are the component author's contract.
   */
  components?: Record<string, ComponentEntry> | undefined;
  /**
   * Variable name -> value, for `{name}` / `{name.member}` expressions
   * (dot notation only). Like `components`, this is the allowlist: every
   * segment of a reference is validated against these values at parse time,
   * so a path that would not resolve (unknown root name, or a member missing
   * at any depth) renders as nothing and is reported
   * (`kind: "unknown-variable"`). The values also give variable references
   * their inferred `SchemaType` for prop type checking.
   */
  variables?: Record<string, unknown> | undefined;
  /**
   * Variable name -> declared `SchemaType`. Optional refinement of
   * `variables`: a declared type (an object shape is walked along dot paths)
   * takes precedence over the type inferred from the value, and a variable
   * declared here counts as known even without a value. Useful when a value
   * alone under-describes the type (or is not representative).
   */
  variableTypes?: Readonly<Record<string, SchemaType>> | undefined;
  /** Placeholder rendered at the streaming frontier (default: renders null). */
  Pending?: ComponentType<unknown> | undefined;
  /** Optional resolver, consulted before the `components` map. */
  resolveComponent?: ((name: string) => ComponentType<never> | undefined) | undefined;
  /** Behavior for an unresolved component tag (default: "pending"). */
  onUnknownComponent?: UnknownComponentBehavior | undefined;
  /**
   * Allowlist of intrinsic (lowercase) HTML elements — the schema counterpart
   * of `components`. A list of tag names, or a record mapping each allowed
   * tag to `true` (any prop), to its allowed prop names, or to prop name ->
   * `SchemaType` (`{ div: true, a: { href: "url", title: "string" } }`).
   * Absent = every intrinsic tag renders. Whether or not it is set, the
   * built-in host prop rules always apply (see `checkProp`): string `style`
   * values, `dangerouslySetInnerHTML` &c., non-function `on*` handlers, and
   * `javascript:` URLs are dropped and reported (`kind: "invalid-prop"`).
   * `formatPromptContract` serializes the whole schema into a system-prompt
   * spec for the generating model.
   */
  elements?: ElementAllowlist | undefined;
  /** Behavior for a disallowed intrinsic tag (default: "skip"). */
  onDisallowedElement?: DisallowedElementBehavior | undefined;
}

/** The component a component-like tag resolves to, if any. */
export function resolveComponent(
  options: RenderOptions,
  tag: string,
): ComponentType<never> | undefined {
  return options.resolveComponent?.(tag) ?? resolveComponentEntry(options.components?.[tag]);
}

/** Default frontier placeholder: an invisible node. */
export function Pending(): ReactNode {
  return null;
}

/**
 * Whether the enclosing component element has finished streaming. The
 * renderer wraps every resolved component element in a provider; host
 * elements get none (they have no way to read it).
 */
const ElementCompleteContext = createContext(true);

/**
 * Inside a component rendered by the parser: `false` while the component's
 * element is still open on the stream (its children may still grow), `true`
 * once its closing tag has arrived — or it was self-closing, auto-closed by
 * mismatch recovery, or auto-closed at the end of the stream. Its props are
 * final from the first render either way: an element only appears once its
 * opening tag is complete.
 *
 * Reads the nearest parser-rendered component element, so a component used
 * internally by another one sees its host's status. Outside any
 * parser-rendered tree it returns `true`.
 */
export function useIsElementComplete(): boolean {
  return useContext(ElementCompleteContext);
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
  const cache = new WeakMap<Node, ReactNode>();
  const PendingComponent = options.Pending ?? Pending;
  const unknownComponent = options.onUnknownComponent ?? "pending";
  const disallowedElement = options.onDisallowedElement ?? "skip";

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
      case "variable": {
        // An unresolvable path was reported at parse time ("unknown-variable").
        const result = options.variables && resolveVariablePath(options.variables, node.path);
        return result?.found ? (result.value as ReactNode) : undefined;
      }
      case "expression": {
        const value = renderValue(node.value);
        // Re-key nested JSX so the parent array key is this expression's
        // (unique) id, not the nested node's local id.
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
      // Drop schema-rejected props (reported at parse time as "invalid-prop");
      // left in, React would throw on e.g. string styles.
      if (checkProp(node.tag, name, value, options) !== null) continue;
      props[name] = renderValue(value);
    }
    const children = node.children.map(renderNode);
    if (resolved.kind === "host") return createElement(resolved.tag, props, ...children);
    // Always wrap (even once closed) so completion updates the provider value
    // instead of changing the element type, which would remount the component.
    const { key, ...componentProps } = props;
    return createElement(
      ElementCompleteContext.Provider,
      { key: key as number, value: node.status === "closed" },
      createElement(
        resolved.type as ComponentType<Record<string, unknown>>,
        componentProps,
        ...children,
      ),
    );
  }

  function renderValue(value: unknown): ReactNode {
    if (value === UNSUPPORTED_EXPRESSION) return null;
    if (isNode(value)) return renderNode(value);
    return value as ReactNode;
  }

  function resolveType(tag: string): Resolved {
    if (!isComponentName(tag)) {
      if (isElementAllowed(options.elements, tag)) return { kind: "host", tag };
      return { kind: disallowedElement };
    }
    const component = resolveComponent(options, tag);
    if (component) return { kind: "component", type: component };
    return unknownComponent === "passthrough" ? { kind: "host", tag } : { kind: unknownComponent };
  }

  return { render };
}

function isNode(value: unknown): value is Node {
  return value !== null && typeof value === "object" && "kind" in value;
}
