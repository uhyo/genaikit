/**
 * `bindGenUi` — the client half of a {@link GenUiSchema}: attach the
 * implementations (components, variable values, action handlers) to the
 * data-only schema, producing the options for `createGenUiMessage` /
 * `useGenUiMessage`.
 *
 * The bindings are checked against the schema both at the type level (every
 * declared component needs an implementation whose props accept what the
 * schema lets the model pass; variable values must match their declared
 * types) and at runtime (a missing or undeclared binding throws), so the
 * catalog the model is prompted with and the catalog the client renders
 * cannot drift apart.
 */

import type { ComponentSpec, SchemaType } from "@ingenui/incremental-jsx-parser";
import type { ComponentType, ReactNode } from "react";

import type { ActionHandler, ActionsDefinition } from "./actions";
import type { GenUiMessageOptions } from "./message";
import type { GenUiSchema } from "./schema";

/**
 * The TypeScript type of a value of a given `SchemaType`: `"string"` / `"url"`
 * → `string`, `"node"` → `ReactNode`, `"function"` → a function, unions →
 * unions, object shapes → object types, `"any"` → `any` (as is a widened,
 * non-literal `SchemaType`).
 */
export type InferSchemaType<T> = SchemaType extends T
  ? any
  : T extends "string" | "url"
    ? string
    : T extends "number"
      ? number
      : T extends "boolean"
        ? boolean
        : T extends "function"
          ? (...args: any[]) => unknown
          : T extends "object"
            ? Record<string, any>
            : T extends "node"
              ? ReactNode
              : T extends "any"
                ? any
                : T extends readonly (infer U)[]
                  ? InferSchemaType<U>
                  : T extends object
                    ? { -readonly [K in keyof T]: InferSchemaType<T[K]> }
                    : never;

/**
 * The props a component declared in a schema may receive: every declared
 * prop is **optional** (the model may omit any of them), plus `children`
 * from the JSX body. `true` / no declaration → any props.
 */
export type InferComponentProps<D> = D extends { readonly props: infer P }
  ? P extends readonly string[]
    ? { -readonly [K in P[number]]?: any } & { children?: ReactNode }
    : P extends true
      ? any
      : { -readonly [K in keyof P]?: InferSchemaType<P[K]> } & { children?: ReactNode }
  : any;

type ComponentsOf<S extends GenUiSchema> = NonNullable<S["components"]>;
type VariableTypesOf<S extends GenUiSchema> = NonNullable<S["variableTypes"]>;
type ActionsOf<S extends GenUiSchema> = NonNullable<S["actions"]>;

/** The implementations to bind to a schema `S` (see {@link bindGenUi}). */
export type GenUiBindings<S extends GenUiSchema> = (keyof ComponentsOf<S> extends never
  ? { components?: Record<never, never> }
  : {
      /** An implementation for every component declared in the schema. */
      components: {
        [K in keyof ComponentsOf<S>]: ComponentType<InferComponentProps<ComponentsOf<S>[K]>>;
      };
    }) &
  (keyof VariableTypesOf<S> extends never
    ? { variables?: Record<never, never> }
    : {
        /** A value for every variable declared in the schema, of its declared type. */
        variables: { [K in keyof VariableTypesOf<S>]: InferSchemaType<VariableTypesOf<S>[K]> };
      }) & {
    /** Optional host handlers for declared actions (undeclared ones only notify). */
    actions?: { [K in keyof ActionsOf<S>]?: ActionHandler };
  };

/** What {@link bindGenUi} returns: the schema-derived `createGenUiMessage` options. */
export type BoundGenUi = Pick<
  GenUiMessageOptions,
  | "elements"
  | "components"
  | "variables"
  | "variableTypes"
  | "actions"
  | "dynamicActions"
  | "mismatchedTag"
>;

function checkKeys(kind: string, declared: object, bound: object): void {
  for (const name of Object.keys(declared)) {
    if (!Object.hasOwn(bound, name)) {
      throw new Error(`bindGenUi: no implementation bound for ${kind} "${name}"`);
    }
  }
  for (const name of Object.keys(bound)) {
    if (!Object.hasOwn(declared, name)) {
      throw new Error(`bindGenUi: ${kind} "${name}" is not declared in the schema`);
    }
  }
}

/**
 * Bind implementations to a {@link GenUiSchema}, producing the options to
 * spread into `createGenUiMessage` / `useGenUiMessage` (next to the
 * client-only options such as `Pending`, `onAction`, and `onIssue`):
 *
 * ```ts
 * const genUi = bindGenUi(schema, {
 *   components: { Card, Button },
 *   variables: { user },
 *   actions: { subscribe: () => openCheckout() },
 * });
 * useGenUiMessage(source, { ...genUi, Pending: Shimmer, onAction });
 * ```
 *
 * Throws when a declared component or variable has no binding, or when a
 * binding (component, variable, or action handler) is not declared in the
 * schema — the model is only ever told about the schema.
 */
export function bindGenUi<const S extends GenUiSchema>(
  schema: S,
  bindings: NoInfer<GenUiBindings<S>>,
): BoundGenUi {
  const componentImpls: Readonly<Record<string, ComponentType<never>>> = bindings.components ?? {};
  const variableValues: Readonly<Record<string, unknown>> = bindings.variables ?? {};
  const handlers: Readonly<Record<string, ActionHandler | undefined>> = bindings.actions ?? {};
  const declaredComponents = schema.components ?? {};
  const declaredActions = schema.actions ?? {};

  checkKeys("component", declaredComponents, componentImpls);
  checkKeys("variable", schema.variableTypes ?? {}, variableValues);
  for (const name of Object.keys(handlers)) {
    if (!Object.hasOwn(declaredActions, name)) {
      throw new Error(`bindGenUi: action "${name}" is not declared in the schema`);
    }
  }

  const components: Record<string, ComponentSpec> = {};
  for (const [name, entry] of Object.entries(declaredComponents)) {
    components[name] = {
      component: componentImpls[name],
      props: entry === true ? true : entry.props,
      description: entry === true ? undefined : entry.description,
    };
  }

  const actions: Record<string, ActionsDefinition[string]> = {};
  for (const [name, entry] of Object.entries(declaredActions)) {
    actions[name] = handlers[name] ?? entry;
  }

  return {
    elements: schema.elements,
    components,
    variables: { ...variableValues },
    variableTypes: schema.variableTypes,
    actions,
    dynamicActions: schema.dynamicActions,
    mismatchedTag: schema.mismatchedTag,
  };
}
