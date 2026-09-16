---
"jsx-incremental-parser": minor
---

Add a tightened schema for untrusted AI-generated JSX, and a prompt contract
derived from it.

- New `elements` option: an allowlist of intrinsic (lowercase) HTML tags —
  `["div", "a"]` or `{ div: true, a: ["href"] }` with per-tag prop
  allowlists. A rejected tag is reported (`kind: "disallowed-element"`) and
  rendered per the new `onDisallowedElement` option (`"skip"` default, or
  `"pending"`).
- Built-in host prop rules now always apply to intrinsic elements; each
  violation is reported (`kind: "invalid-prop"`) and the prop is dropped
  instead of reaching React: string `style` values (previously these made
  React throw at render time, blanking the tree), `dangerouslySetInnerHTML`
  / `srcDoc` / `ref` / `key` / `children`, `on*` handlers that don't
  reference a predefined variable (`onClick={actions.confirm}` still works
  and wires the real function), and `javascript:`-style URL schemes.
- New `formatPromptContract(options)` serializes the configured schema
  (syntax subset, allowed elements/props, components, variable shapes) into
  system-prompt-ready text for the model generating the stream.
- The canonical checks (`isElementAllowed`, `checkProp`) and the new
  core hooks (`isAllowedElement`, `checkProp`) are exported from both the
  root and `/core` entries, so custom renderers can enforce exactly what the
  parse-time events report.
