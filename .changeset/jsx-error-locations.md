---
"@ingenui/incremental-jsx-parser": patch
---

Report source locations on JSX errors. Every `JsxErrorEvent` now carries a
`location: SourceLocation` — 1-based `line`/`column`, stream `offset`, and
`lineText` (the content of the offending line, as streamed so far) — pointing
at the offending construct: the `<` of a mismatched/unknown/unclosed tag, the
`{` of an unsupported expression. Errors inside a nested JSX expression are
reported at the enclosing `{`.

New `formatJsxError(event)` export (root and `/core` entries) renders the
message, position, and a caret code frame in one string:

```text
Mismatched closing tag </b>; expected </a> (line 2, column 8)

  2 |   hello</b>
    |        ^
```

Locations are chunking-invariant like the rest of the token stream.
