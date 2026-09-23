# The `actions` convention

`actions` is the bridge from the generated UI back into the conversation.
The app declares actions; the model wires them wherever a function is
expected (`onClick={actions.submit}`); when the user triggers one, ingenui
hands the app the canonical next request:
``The `actions.submit` action was fired by the user.``

```ts
const message = createGenUiMessage(stream, {
  actions: {
    submit: (event) => {/* runs in addition to onAction */},
    cancel: true, // no local handler; still reported through onAction
  },
  onAction: ({ name, reference, message, args }) => {
    // name: "submit", reference: "actions.submit"
    // message: "The `actions.submit` action was fired by the user."
    sendToModel(message);
  },
});
```

Under the hood each action becomes an entry of the predefined `actions`
variable (declared `"function"` in the schema), so the parser validates
references at parse time, and `onClick={actions}` (not a function) fails the
type check. The helpers (`formatActionMessage`, `createActionsVariable`) are
exported for custom setups.

## Model-defined actions: the `dynamicActions` default

An AI-defined action carries no host behavior — all it can ever do is send
the canonical "this action was fired" message back into the conversation. So
a declaration adds nothing the reference itself doesn't already say: **the
name is the definition.** By default (`dynamicActions: true`), any
`actions.<name>` the model writes resolves to a notify-only action:

````markdown
Which plan would you like?

```ui+jsx
<div>
  <button onClick={actions.choosePlanBasic}>Basic</button>
  <button onClick={actions.choosePlanPro}>Pro</button>
</div>
```
````

Clicking "Pro" fires `onAction` with `declared: false` and the message
``The `actions.choosePlanPro` action was fired by the user.`` — the model
invented the name, so it knows what it means. Declared actions keep working
exactly as before (`declared: true`, local handler runs); an undeclared name
never runs host code, so apps switching on `event.name` should treat unknown
names as pass-through-to-the-model.

`formatGenUiPrompt` follows the same default and tells the model it may
invent action names.

## Opting out

Pass `dynamicActions: false` (to both `createGenUiMessage` and
`formatGenUiPrompt`) when the host owns the action vocabulary — then a
reference outside the declared `actions`, including a typo in a declared
name, is caught as an `unknown-variable` issue, and with no `actions`
declared the variable does not exist at all.

## Implementation note

With dynamic actions, the `actions` value becomes a `Proxy` answering for any
name, which the parser's `in`-semantics variable resolution accepts and
type-infers as `"function"` — chunk invariance and the rest of the schema are
untouched. Inherited `Object.prototype` member names like `toString` are left
alone.
