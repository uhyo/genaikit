---
"jsx-incremental-parser": patch
---

Generalize the schema into a lightweight prop type system. What was a
hardcoded rule ("`style` must be a variable resolving to an object") is now
a declaration in a small, shared type language — and integrators can declare
the same for their own components and elements.

- New `SchemaType`: `"string" | "number" | "boolean" | "function" |
  "object" | "node" | "url" | "any"`, unions (`["string", "number"]`), and
  object shapes (`{ name: "string" }`).
- **Component catalog declares props**: a `components` entry can now be a
  `{ component, props }` spec, where `props` is `true`, a list of allowed
  prop names, or prop name → `SchemaType`. Every parsed prop on that
  component is validated against the declaration; violations are reported
  (`kind: "invalid-prop"`) and dropped. Undeclared components stay exempt
  (the author's contract).
- **Elements declare prop types**: the `elements` record form now also
  accepts prop name → `SchemaType` per tag
  (`{ a: { href: "url", title: "string" } }`), in addition to `true` and
  name lists.
- **Variables carry types**: new `variableTypes` option declares a
  `SchemaType` per variable (shapes are walked along dot paths, and a
  declared variable counts as known even without a value); otherwise the
  type is inferred from the `variables` value. Variable references in props
  are checked against the declared prop type — e.g. `onClick={user.name}`
  is now rejected when `user.name` is a string.
- The built-in host rules are expressed in the same system (`style:
  "object"`, `on*`: `"function"`, URL props: `"url"`, plus the hard
  blocklist) and always apply to intrinsic elements — a user schema can
  tighten them, never relax them.
- `formatPromptContract` now describes declared prop and variable types, so
  the generating model sees the same contract the parser enforces.
- API: `checkHostProp` is renamed to `checkProp` (it now covers component
  props too); new exports `checkPropValue`, `resolveVariableType`,
  `describeType`, `resolveComponentEntry` and types `SchemaType`,
  `PropTypes`, `PropsDefinition`, `ComponentEntry`, `ComponentSpec`,
  `ComponentSchemaEntry`.
