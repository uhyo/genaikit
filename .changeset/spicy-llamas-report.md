---
"@ingenui/incremental-jsx-parser": patch
---

Restructure error handling into two channels split by recoverability.

`onJsxError` is the channel for **recoverable** errors: unified, structured
JSX-level events that fire synchronously at parse time (inside `write()` /
`end()`), before any render and in every recovery mode, so a stream producer
(e.g. an LLM agent) can get instant feedback while the tree keeps recovering
tolerantly as before. The `JsxErrorEvent` union covers `"mismatched-tag"`
(including stray closes), `"unknown-component"`, `"unsupported-expression"`,
and `"unclosed-tag"` at end of input; each event carries a human-readable
`message`.

`onStreamError` is the channel for the one **unrecoverable** error: the
stream source failing. It receives the raw error once, alongside the existing
`done` rejection.

The core `createParser` accepts `onJsxError` too, plus an `isKnownComponent`
predicate to enable unknown-component detection without React; the
`isComponentName` helper is now exported.

Breaking (pre-release cleanup): the legacy `onError` callback is removed —
use `onJsxError` / `onStreamError`. Reporting is now decoupled from recovery,
so the reporting-only modes are gone: `mismatchedTag` is
`"autoclose" | "ignore"` (the `"error"` mode behaved like `"ignore"` plus a
report), and `onUnknownComponent`'s `"error"` mode is renamed `"skip"`
(renders nothing).
