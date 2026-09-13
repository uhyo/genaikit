---
"jsx-incremental-parser": minor
---

Add `onJsxError`: a unified, structured error event channel for JSX-level errors.

Events fire synchronously at parse time (inside `write()` / `end()`), before any
render and in every recovery mode, so a stream producer (e.g. an LLM agent) can
get instant feedback while the tree keeps recovering tolerantly as before. The
`JsxErrorEvent` union covers `"mismatched-tag"` (including stray closes),
`"unknown-component"`, `"unsupported-expression"`, and `"unclosed-tag"` at end
of input, each with a human-readable `message`.

The core `createParser` accepts `onJsxError` too, plus an `isKnownComponent`
predicate to enable unknown-component detection without React; the
`isComponentName` helper is now exported. The existing `onError` callback is
unchanged.
