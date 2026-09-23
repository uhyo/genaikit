# Streaming model and supported JSX

## The core idea: a single frontier

A stream is one linear sequence of characters, so at any instant there is exactly
**one cursor** between "received" and "not yet received". While the stream is
open, the snapshot therefore contains **exactly one `<Pending />`**, nested inside
whatever elements are currently open:

| Received so far    | Snapshot                                            |
| ------------------ | --------------------------------------------------- |
| `<div>`            | `<div><Pending/></div>`                             |
| `<div>Hello`       | `<div>Hello<Pending/></div>`                        |
| `<div><span>`      | `<div><span><Pending/></span></div>`                |
| `<div><sp`         | `<div><Pending/></div>` (partial child tag hidden)  |
| `<div title="bo`   | `<Pending/>` (unfinished open tag → div hidden)      |
| `<div>{`           | `<div><Pending/></div>` (unfinished expression)     |
| `<div>a</div>` eof | `<div>a</div>` (no Pending once the stream ends)     |

Settled subtrees are frozen and reused by reference; only the open path and
the single `Pending` are rebuilt per chunk, so React reconciliation stays
cheap. The result never depends on how the stream happens to be split
(verified by a fuzz suite).

## Supported JSX subset

This is **not** a JavaScript parser. It recognizes a small, safe JSX subset:

- **Elements** — host/intrinsic (`<div>`, lowercase), components (`<Card>`,
  Capitalized, resolved via `components` / `resolveComponent`), self-closing
  (`<br />`), and fragments (`<>…</>`).
- **Attributes** — string values (`prop="x"`, `prop='x'`), boolean shorthand
  (`disabled` → `disabled={true}`), and expression values `prop={…}`.
- **Children** — text, nested elements/fragments, and expression containers
  `{…}`.
- **Text** — matches real JSX parser semantics: HTML character references are
  decoded (numeric `&#65;` / `&#x1F600;` plus the named HTML4 set and
  `&apos;`; unknown ones stay verbatim) in text and in string attribute
  values, and JSX whitespace rules apply — indentation and whitespace-only
  lines around child elements are dropped, and a line break inside text
  collapses to a single joining space (whitespace within a single line is
  kept).
- **Expressions** inside `{ }` (props and children) are limited to: string and
  template literals **without** `${}` substitutions, number literals,
  `true` / `false` / `null` / `undefined`, a **predefined variable** reference
  (`{name}`, or dot-notation member access `{user.name.first}`, resolved via the
  `variables` option), and a nested JSX element/fragment.

Anything outside this subset (computed/bracket member access, calls,
arithmetic, spreads, …) is treated as a recoverable error: it renders as
nothing and is reported through [`onJsxError`](./errors.md).

Nested JSX *inside an expression* (`{<b>…</b>}`) is buffered until its `}`:
it appears at once rather than streaming its own inner frontier.
