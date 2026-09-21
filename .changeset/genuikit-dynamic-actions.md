---
"genuikit": minor
---

Model-defined actions: with `dynamicActions: true`, the model may define its
own actions simply by referencing them — any `actions.<name>` resolves to a
notify-only action (no declaration syntax needed; the name is the
definition). Undeclared names never run host code: they only emit the
canonical "The `actions.<name>` action was fired by the user." message, with
`declared: false` on the `ActionEvent`. `formatGenUiPrompt` takes the same
flag and tells the model it may invent action names. Declared actions are
unchanged (`declared: true`, local handlers still run), and with the flag off
a reference outside the declared set is still reported as an
`unknown-variable` issue.
