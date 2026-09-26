/**
 * The **GenUI schema** (`ingenui/schema`): everything that decides how a
 * message *parses* — the element allowlist, the component catalog (prop
 * types + descriptions), the predefined variables' types, the actions, and
 * the mismatched-tag recovery — as plain, JSON-serializable data with no
 * implementations attached.
 *
 * Being data, one schema module can be imported by both sides of an app:
 *
 * - the **server** builds the system prompt from it (`formatGenUiPrompt`) and
 *   validates the model's stream against it (`ingenui/server`);
 * - the **client** binds the implementations to it (`bindGenUi`: components,
 *   variable values, action handlers) and renders.
 *
 * Because every parse-affecting option lives here, the server and the client
 * report the same issues for the same text. Render-only options (`Pending`,
 * `onUnknownComponent`, `renderMarkdown`, …) stay client-side.
 *
 * This module (and the whole `ingenui/schema` entry) is React-free.
 */

import type {
  ElementAllowlist,
  MismatchBehavior,
  PropsDefinition,
  SchemaType,
} from "@ingenui/incremental-jsx-parser/core";

import type { ActionDefinition } from "./actions";

export type { ActionDefinition } from "./actions";
export type {
  ElementAllowlist,
  MismatchBehavior,
  PropsDefinition,
  PropTypes,
  SchemaType,
} from "@ingenui/incremental-jsx-parser/core";

/** The data-only declaration of a component in a {@link GenUiSchema}. */
export interface ComponentDefinition {
  /**
   * The component's prop catalog: prop names (each `"any"`), or prop name →
   * `SchemaType`. Absent (or `true`) = any props. Children come from the JSX
   * body and are not declared here.
   */
  readonly props?: PropsDefinition | undefined;
  /** What the component is for, shown to the model in the prompt. */
  readonly description?: string | undefined;
}

/**
 * The parse-affecting half of the ingenui options, as plain data. Define it
 * once with {@link defineGenUiSchema} in a module both the server and the
 * client import.
 */
export interface GenUiSchema {
  /** Intrinsic-element allowlist (absent = every intrinsic tag is allowed). */
  readonly elements?: ElementAllowlist | undefined;
  /**
   * The component catalog: component name → its {@link ComponentDefinition}
   * (`true` = any props, no description). These are the only components the
   * model may use; the client binds an implementation to each.
   */
  readonly components?: Readonly<Record<string, ComponentDefinition | true>> | undefined;
  /**
   * Declared types of the predefined variables, keyed by root name. The
   * client binds a value to each. Declare object shapes fully: the server
   * only knows these types, so a member missing from the declaration is an
   * unknown variable on the server.
   */
  readonly variableTypes?: Readonly<Record<string, SchemaType>> | undefined;
  /**
   * The declared actions (`true` or an {@link ActionDefinition} with a
   * description). The client may bind a handler to each.
   */
  readonly actions?: Readonly<Record<string, ActionDefinition | true>> | undefined;
  /**
   * Let the model define its own actions by referencing them (default
   * `true`). See the `actions` convention.
   */
  readonly dynamicActions?: boolean | undefined;
  /** Closing-tag mismatch recovery (default `"autoclose"`). */
  readonly mismatchedTag?: MismatchBehavior | undefined;
}

/**
 * Declare a {@link GenUiSchema}. An identity function at runtime; at the type
 * level it keeps the literal shape (component names, prop types, variable
 * types, action names), which is what lets `bindGenUi` check the bound
 * implementations against the schema.
 */
export function defineGenUiSchema<const S extends GenUiSchema>(schema: S): S {
  return schema;
}
