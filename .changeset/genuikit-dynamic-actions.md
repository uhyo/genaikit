---
"genuikit": patch
---

Model-defined actions, on by default: the model may define its own actions
simply by referencing them — any `actions.<name>` resolves to a notify-only
action (no declaration syntax needed; the name is the definition).
Undeclared names never run host code: they only emit the canonical "The
`actions.<name>` action was fired by the user." message, with
`declared: false` on the `ActionEvent`. Declared actions are unchanged
(`declared: true`, local handlers still run), and `formatGenUiPrompt`
follows the same default, telling the model it may invent action names.
Opt out with `dynamicActions: false` to keep the action vocabulary
host-owned — a reference outside the declared `actions` is then reported as
an `unknown-variable` issue.
