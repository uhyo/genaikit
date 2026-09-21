/**
 * The `actions` convention.
 *
 * genuikit reserves one predefined variable, **`actions`**, as the bridge from
 * AI-generated UI back to the conversation. The host app declares the actions
 * it supports; the model wires them wherever a function is expected
 * (`<button onClick={actions.submit}>`); and when the user triggers one,
 * genuikit emits an {@link ActionEvent} whose `message` is the canonical next
 * user-turn text for the model ("The `actions.submit` action was fired by the
 * user."). The host app forwards that message as the next request.
 */

import type { SchemaType } from "jsx-incremental-parser";

/** A host-side handler run (in addition to `onAction`) when an action fires. */
export type ActionHandler = (...args: readonly unknown[]) => void;

/**
 * The actions the model may use: action name -> handler, or `true` for an
 * action with no local handler (it still fires `onAction`).
 */
export type ActionsDefinition = Readonly<Record<string, ActionHandler | true>>;

/** Emitted when the user triggers an action in AI-generated UI. */
export interface ActionEvent {
  /** The action's name (`"submit"`). */
  name: string;
  /** The reference as the model writes it (`"actions.submit"`). */
  reference: string;
  /**
   * The canonical text to send to the model as the next request, e.g.
   * "The `actions.submit` action was fired by the user."
   */
  message: string;
  /** The raw arguments the UI passed (e.g. a React event object). */
  args: readonly unknown[];
}

export type ActionListener = (event: ActionEvent) => void;

/** The canonical next-request text for a fired action. */
export function formatActionMessage(name: string): string {
  return `The \`actions.${name}\` action was fired by the user.`;
}

/** The wired `actions` variable plus its declared schema type. */
export interface ActionsVariable {
  /** Value for the parser's `variables.actions`. */
  values: Readonly<Record<string, ActionHandler>>;
  /** Declared shape for the parser's `variableTypes.actions` (all `"function"`). */
  type: SchemaType;
}

/**
 * Wrap an {@link ActionsDefinition} into the actual `actions` variable handed
 * to the JSX parser: each entry becomes a function that emits the
 * {@link ActionEvent} through `onAction` and then runs the host handler, if
 * one was given.
 */
export function createActionsVariable(
  actions: ActionsDefinition,
  onAction: ActionListener | undefined,
): ActionsVariable {
  const values: Record<string, ActionHandler> = {};
  const shape: Record<string, SchemaType> = {};
  for (const [name, handler] of Object.entries(actions)) {
    values[name] = (...args) => {
      onAction?.({ name, reference: `actions.${name}`, message: formatActionMessage(name), args });
      if (typeof handler === "function") handler(...args);
    };
    shape[name] = "function";
  }
  return { values, type: shape };
}
