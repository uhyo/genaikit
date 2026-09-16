# jsx-incremental-parser

Incrementally parse a **streamed JSX string** into a **live React tree**.

As JSX text arrives chunk-by-chunk (for example, AI-generated UI streaming from
a server), this library keeps a snapshot of the parsed tree up to date. Whatever
has not finished streaming yet is represented by a single `<Pending />`
placeholder at the streaming frontier, so you can render a spinner, skeleton, or
shimmer exactly where the next content will appear.

- **Incremental & cheap** — settled subtrees are frozen and reused; only the
  open path and the single `Pending` are rebuilt per chunk.
- **Chunk-independent** — the result never depends on how the byte/character
  stream happens to be split (verified by fuzz tests).
- **Lenient by design** — malformed or truncated AI output degrades gracefully
  instead of throwing.
- **Framework-agnostic core** — the `/core` entry has zero React dependency.

> **Status:** early development (`0.0.0`). The API described here is implemented
> and tested, but may still change before a stable release.

## Install

```sh
npm install jsx-incremental-parser
# react / react-dom are peer dependencies (>= 18)
```

## Quick start (React hook)

```tsx
import { useIncrementalJsx } from "jsx-incremental-parser/react";

function StreamedUI({ stream }: { stream: ReadableStream<Uint8Array> }) {
  return useIncrementalJsx(stream, {
    components: { Card, Button },
    Pending: () => <span className="shimmer" />,
  });
}

// e.g. drive it from a fetch:
const res = await fetch("/api/ui-stream");
<StreamedUI stream={res.body!} />;
```

The hook subscribes via `useSyncExternalStore`, re-rendering only when the parsed
tree changes, and disposes the stream automatically on unmount.

## Demo

An interactive playground lives in [`demo/`](./demo). It streams sample JSX
character-by-character and shows the raw text next to the live React tree, with a
shimmer at the `<Pending />` frontier:

```sh
cd demo
pnpm install
pnpm dev
```

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

## Supported JSX subset

This is **not** a JavaScript parser. It recognizes a small, safe JSX subset:

- **Elements** — host/intrinsic (`<div>`, lowercase), components (`<Card>`,
  Capitalized, resolved via `components` / `resolveComponent`), self-closing
  (`<br />`), and fragments (`<>…</>`).
- **Attributes** — string values (`prop="x"`, `prop='x'`), boolean shorthand
  (`disabled` → `disabled={true}`), and expression values `prop={…}`.
- **Children** — text, nested elements/fragments, and expression containers
  `{…}`.
- **Expressions** inside `{ }` (props and children) are limited to: string and
  template literals **without** `${}` substitutions, number literals,
  `true` / `false` / `null` / `undefined`, a **predefined variable** reference
  (`{name}`, or dot-notation member access `{user.name.first}`, resolved via the
  `variables` option), and a nested JSX element/fragment.

Anything outside this subset (computed/bracket member access, calls,
arithmetic, spreads, …) is treated as a recoverable error: it renders as
nothing and is reported through `onJsxError`.

## API

### `useIncrementalJsx(source, options?)` — `jsx-incremental-parser/react`

React hook returning the live `ReactNode`. Re-creates the parser when `source`
identity changes and disposes it on unmount.

### `createIncrementalJsxParser(source, options?)` — `jsx-incremental-parser`

Lower-level React store, shaped as a drop-in for `useSyncExternalStore`:

```ts
const parser = createIncrementalJsxParser(source, options);

parser.getSnapshot(); // => ReactNode (stable ref until the tree changes)
parser.getServerSnapshot(); // SSR-safe snapshot
const unsubscribe = parser.subscribe(() => {/* re-render */});
parser.dispose(); // cancel the stream and detach
await parser.done; // resolves on completion, rejects on a fatal stream error
```

**Accepted `source` types:** `ReadableStream<Uint8Array>` (decoded with a
streaming `TextDecoder` — the common `fetch().body` case),
`ReadableStream<string>`, or any `AsyncIterable<string | Uint8Array>`.

**Options:**

| Option               | Type                                                | Default        | Description                                                        |
| -------------------- | --------------------------------------------------- | -------------- | ----------------------------------------------------------------- |
| `components`         | `Record<string, ComponentType>`                     | —              | Map of Capitalized tag names to React components.                 |
| `variables`          | `Record<string, unknown>`                           | —              | Values for `{name}` / `{name.member}` variable expressions.      |
| `resolveComponent`   | `(name) => ComponentType \| undefined`              | —              | Resolver consulted before `components`.                           |
| `Pending`            | `ComponentType`                                      | renders `null` | Placeholder rendered at the frontier.                             |
| `onUnknownComponent` | `"pending" \| "skip" \| "passthrough"`              | `"pending"`    | How to *render* an unresolved component tag.                      |
| `mismatchedTag`      | `"autoclose" \| "ignore"`                           | `"autoclose"`  | How to *repair* a closing tag that doesn't match the open element. |
| `onJsxError`         | `(event: JsxErrorEvent) => void`                    | —              | Recoverable errors: unified structured JSX-level events, fired at parse time. |
| `onStreamError`      | `(error: unknown) => void`                          | —              | Unrecoverable errors: the stream source failed (`done` rejects too). |

The `components` map also acts as a **security allowlist** for untrusted
AI-generated output — unknown components do not render by default. The
`variables` map works the same way for `{name}` expressions, and because it
holds the actual values, **every segment** of a dot path is validated against
them at parse time: `{user.nmae}` fires an `"unknown-variable"` event the
moment it is parsed and renders as nothing. Lookup uses `in` semantics
(prototype chain included; primitives are boxed, so `{title.length}` on a
string resolves), and a member behind a `null`/`undefined` value is reported
rather than crashing anything.

### `createParser(options?)` — `jsx-incremental-parser/core`

Framework-agnostic, push-based core that emits a renderer-independent AST. Zero
React dependency.

```ts
import { createParser } from "jsx-incremental-parser/core";

const core = createParser();
core.write("<div>partial");
core.getTree(); // => readonly Node[] (immutable AST snapshot, incl. a PendingNode)
core.subscribe(listener);
core.end(); // finalize; drops the Pending frontier
```

`createParser` accepts `mismatchedTag` and `onJsxError` like the React
adapter. Since the core knows nothing about React components, pass
`isKnownComponent: (tag) => boolean` if you want `"unknown-component"` events;
the exported `isComponentName(tag)` helper tells you which tags are
component-like (Capitalized or dotted). Likewise, pass
`isKnownVariable: (path: readonly string[]) => boolean` for
`"unknown-variable"` events — it receives the full dot path, so you can
validate the root name only (`path[0]`) or every segment. The core emits
variable references as `VariableNode`s (a dot-notation `path`) and leaves
resolving them to the consumer; the exported
`resolveVariablePath(variables, path)` helper implements the canonical lookup
(the React adapter uses it for both parse-time validation and render-time
resolution, so the two always agree).

## Error handling

AI output is frequently malformed, so the parser is **lenient by default**:

- **Missing close tags** at end of stream are auto-closed (best-effort content).
- **Mismatched closing tags** mid-stream follow `mismatchedTag` (default
  `"autoclose"`).
- **Unsupported expressions** render as nothing.
- **Source read errors** reject `done` and call `onStreamError`; the last good
  snapshot is always preserved — errors never blank the UI.

Two channels split the reporting by recoverability: every **recoverable**
JSX-level error goes through the structured `onJsxError` channel below, while
the one **unrecoverable** case — the stream source failing — goes through
`onStreamError` (and rejects `done`).

### Instant, structured feedback: `onJsxError`

Leniency is about the rendered tree; it should not hide problems from the
*producer* of the stream. When the JSX is generated by an AI agent, you usually
want to tell the agent about a malformed tag or an unknown component right
away. `onJsxError` is the single, unified error channel for exactly that:

- **Fires at parse time** — synchronously inside `write()` / `end()`, the
  moment the error is detected, before (and independent of) any render.
- **Fires in every recovery mode** — reporting is decoupled from recovery, so
  `mismatchedTag` and `onUnknownComponent` only choose how the tree degrades
  gracefully; they never silence an event.
- **Chunking-invariant** — the same input produces the same events however the
  stream is split.

```ts
import { formatJsxError, type JsxErrorEvent } from "jsx-incremental-parser";

const parser = createIncrementalJsxParser(stream, {
  components: { Card, Button },
  onJsxError: (event: JsxErrorEvent) => {
    // Feed it straight back to the generating agent:
    agent.report(formatJsxError(event));
  },
});
```

`JsxErrorEvent` is a discriminated union on `kind`; every variant carries a
human-readable `message` and a `location`:

| `kind`                     | Extra fields                | Emitted when                                                                                     |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| `"mismatched-tag"`         | `tag`, `expected`           | A closing tag doesn't match the innermost open element (`expected: null` = stray close).         |
| `"unknown-component"`      | `tag`                       | A Capitalized/dotted tag fails `resolveComponent` / `components` resolution, at open time.       |
| `"unknown-variable"`       | `name`, `path`              | A `{ }` variable reference that does not resolve through `variables` (any segment).              |
| `"unsupported-expression"` | `expression`, `attribute?`  | A `{ }` expression falls outside the supported subset.                                           |
| `"unclosed-tag"`           | `tag`                       | An element is still open when the stream ends (reported innermost first, then auto-closed).      |

### Error locations: `location` and `formatJsxError`

`location` is a `SourceLocation` pointing at the offending construct — the `<`
of a mismatched/unknown/unclosed tag, the `{` of an unsupported expression:

```ts
interface SourceLocation {
  line: number; // 1-based
  column: number; // 1-based, UTF-16 code units
  offset: number; // 0-based from the start of the stream, UTF-16 code units
  lineText: string; // the offending line, as streamed so far
}
```

Because the input is a stream, `lineText` holds the line as far as it had
arrived when the error was captured — for the common single-line case that is
the whole construct. The exported `formatJsxError(event)` renders the message,
position, and a caret code frame in one string, ready to log or to feed back
to the agent producing the stream:

```text
Mismatched closing tag </b>; expected </a> (line 2, column 8)

  2 |   hello</b>
    |        ^
```

One caveat: errors *inside* a nested JSX expression (`{<b>…</b>}` is buffered
and parsed on its own) are reported at the enclosing `{`.

## License

MIT © uhyo
