---
"jsx-incremental-parser": minor
---

Support variable references in `{ }` expressions: a bare identifier (`{name}`) or dot-notation member access (`{user.name.first}`), in both children and props. Variables are predefined through the new `variables` option (`Record<string, unknown>`), mirroring how `components` works — a reference whose root name is not in the map renders as nothing and is reported through `onJsxError` as the new `"unknown-variable"` event. The framework-agnostic core emits variable references as a new `VariableNode` (`kind: "variable"`, with the dot path) and accepts an `isKnownVariable` probe for parse-time error events; the React adapter resolves the path null-safely at render time.
