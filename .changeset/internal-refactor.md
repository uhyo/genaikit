---
"@ingenui/incremental-jsx-parser": patch
"ingenui": patch
---

Internal refactoring: the parser's AST primitives and error events move into dependency-free modules (no more import cycles), and duplicated logic (component resolution, fence parsing, `actions` variable wiring) is shared. `IncrementalJsxParserOptions` fields now also accept an explicit `undefined`, and `GenUiMessage` extends `IncrementalJsxParser`. With `dynamicActions: false` and an empty `actions` map, the `actions` variable is no longer defined (matching the prompt).
