/**
 * The `actions` convention.
 *
 * ingenui reserves one predefined variable, **`actions`**, as the bridge from
 * AI-generated UI back to the conversation. The host app declares the actions
 * it supports; the model wires them wherever a function is expected
 * (`<button onClick={actions.submit}>`); and when the user triggers one,
 * ingenui emits an {@link ActionEvent} whose `message` is the canonical next
 * user-turn text for the model ("The `actions.submit` action was fired by the
 * user."). The host app forwards that message as the next request.
 *
 * With **dynamic actions** (ingenui's default; opt out with
 * `dynamicActions: false`), the model may also *define its own*
 * actions simply by referencing them — `onClick={actions.choosePlanPro}` needs
 * no declaration; the name is the definition. This is safe because an
 * undeclared action carries no host behavior: all it can do is emit the
 * canonical message back into the conversation (`declared: false` on the
 * event). Host-declared handlers still run only for declared names.
 * The `actions` variable is then a `Proxy` whose `has` / `get` traps answer
 * for any name, which the parser's `in`-semantics variable resolution accepts
 * and type-infers as `"function"`.
 */

import type { SchemaType } from "@ingenui/incremental-jsx-parser/core";
import { FORBIDDEN_SEGMENTS } from "@ingenui/incremental-jsx-parser/core";

/** A host-side handler run (in addition to `onAction`) when an action fires. */
export type ActionHandler = (...args: readonly unknown[]) => void;

/**
 * The data-only declaration of an action (as in a `GenUiSchema`): no handler,
 * just what the model is told about it.
 */
export interface ActionDefinition {
  /** What the action does, shown to the model in the prompt. */
  readonly description?: string | undefined;
}

/**
 * The actions the model may use: action name -> handler, `true`, or an
 * {@link ActionDefinition} — the latter two declare an action with no local
 * handler (it still fires `onAction`).
 */
export type ActionsDefinition = Readonly<Record<string, ActionHandler | true | ActionDefinition>>;

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
  /**
   * `true` for an action the host declared; `false` for a model-defined
   * (dynamic) action, which only notifies — it never runs host code.
   */
  declared: boolean;
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
  /**
   * Declared shape for the parser's `variableTypes.actions` (all
   * `"function"`). With dynamic actions, names outside this shape fall
   * through to value inference against {@link ActionsVariable.values}, so the
   * declared shape stays valid as-is.
   */
  type: SchemaType;
}

/**
 * Wrap an {@link ActionsDefinition} into the actual `actions` variable handed
 * to the JSX parser: each entry becomes a function that emits the
 * {@link ActionEvent} through `onAction` and then runs the host handler, if
 * one was given.
 *
 * With `dynamic: true`, the returned `values` also resolves **any other
 * name** to a notify-only action function (created lazily, one stable
 * function per name), so the model can define actions by simply referencing
 * them.
 */
export function createActionsVariable(
  actions: ActionsDefinition,
  onAction: ActionListener | undefined,
  dynamic = false,
): ActionsVariable {
  const wrap = (
    name: string,
    handler: ActionsDefinition[string],
    declared: boolean,
  ): ActionHandler => {
    return (...args) => {
      onAction?.({
        name,
        reference: `actions.${name}`,
        message: formatActionMessage(name),
        args,
        declared,
      });
      if (typeof handler === "function") handler(...args);
    };
  };

  const declaredActions: Record<string, ActionHandler> = {};
  const shape: Record<string, SchemaType> = {};
  for (const [name, handler] of Object.entries(actions)) {
    declaredActions[name] = wrap(name, handler, true);
    shape[name] = "function";
  }
  if (!dynamic) return { values: declaredActions, type: shape };

  const invented = new Map<string, ActionHandler>();
  const values = new Proxy(declaredActions, {
    has: (target, prop) => typeof prop === "string" || Reflect.has(target, prop),
    get: (target, prop, receiver) => {
      // Declared actions, symbols, and inherited Object.prototype members
      // (toString &c.) behave normally; everything else is a dynamic action.
      if (typeof prop !== "string" || Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }
      let wrapper = invented.get(prop);
      if (wrapper === undefined) {
        wrapper = wrap(prop, true, false);
        invented.set(prop, wrapper);
      }
      return wrapper;
    },
  });
  return { values, type: shape };
}

/** The actions-related options plus the predefined variables they merge into. */
export interface ActionsOptions {
  actions?: ActionsDefinition | undefined;
  dynamicActions?: boolean | undefined;
  onAction?: ActionListener | undefined;
  variables?: Record<string, unknown> | undefined;
  variableTypes?: Readonly<Record<string, SchemaType>> | undefined;
}

/**
 * Resolve the actions options into the parser's predefined variables: the
 * `actions` variable is merged in (overriding any `actions` key). Dynamic
 * actions are the default, so the variable exists unless they are opted out
 * and no action is declared.
 */
export function withActionsVariable<T extends ActionsOptions>(
  options: T,
): Omit<T, "actions" | "dynamicActions" | "onAction"> {
  const { actions = {}, dynamicActions, onAction, ...rest } = options;
  const dynamic = dynamicActions !== false;
  if (!dynamic && Object.keys(actions).length === 0) return rest;
  const actionsVariable = createActionsVariable(actions, onAction, dynamic);
  return {
    ...rest,
    variables: { ...options.variables, actions: actionsVariable.values },
    variableTypes: { ...options.variableTypes, actions: actionsVariable.type },
  };
}

/** A fired action, resolved against the declared actions (see {@link resolveAction}). */
export interface ResolvedAction {
  /** The action's name (`"submit"`). */
  name: string;
  /** The reference as the model writes it (`"actions.submit"`). */
  reference: string;
  /** The canonical next-request text (see {@link formatActionMessage}). */
  message: string;
  /** `true` for a declared action, `false` for a model-defined (dynamic) one. */
  declared: boolean;
}

const ACTION_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Resolve an action **name** reported by a client (e.g. `{ action: "submit" }`
 * in the next request) against the declared actions — the server-side
 * counterpart of the `actions` variable. Returns `null` when the name is not
 * an action the model could have wired: undeclared with `dynamicActions:
 * false`, or (with dynamic actions) not a valid `actions.<name>` member —
 * non-identifiers, the forbidden segments, and inherited `Object.prototype`
 * members (`toString` &c.) are never actions.
 *
 * Build the next request from the returned `message` instead of trusting
 * client-supplied text.
 */
export function resolveAction(
  options: Pick<ActionsOptions, "actions" | "dynamicActions">,
  name: string,
): ResolvedAction | null {
  const declared = options.actions !== undefined && Object.hasOwn(options.actions, name);
  if (!declared) {
    if (options.dynamicActions === false) return null;
    if (!ACTION_NAME_RE.test(name) || FORBIDDEN_SEGMENTS.has(name) || name in Object.prototype) {
      return null;
    }
  }
  return { name, reference: `actions.${name}`, message: formatActionMessage(name), declared };
}
