---
"jsx-incremental-parser": minor
---

Add `onJsxError`: a unified, structured error event channel — now the parser's
single error channel.

Events fire synchronously at parse time (inside `write()` / `end()`), before
any render and in every recovery mode, so a stream producer (e.g. an LLM
agent) can get instant feedback while the tree keeps recovering tolerantly as
before. The `JsxErrorEvent` union covers `"mismatched-tag"` (including stray
closes), `"unknown-component"`, `"unsupported-expression"`, `"unclosed-tag"`
at end of input, and `"stream-error"` when the source fails (alongside the
`done` rejection); each event carries a human-readable `message`.

The core `createParser` accepts `onJsxError` too, plus an `isKnownComponent`
predicate to enable unknown-component detection without React; the
`isComponentName` helper is now exported.

Breaking (pre-release cleanup): the legacy `onError` callback is removed —
use `onJsxError`. Reporting is now decoupled from recovery, so the
reporting-only modes are gone: `mismatchedTag` is `"autoclose" | "ignore"`
(the `"error"` mode behaved like `"ignore"` plus a report), and
`onUnknownComponent`'s `"error"` mode is renamed `"skip"` (renders nothing).
