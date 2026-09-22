# Implementation Plan: `@ingenui/incremental-jsx-parser`

This document turns [`GOAL.md`](./GOAL.md) into a concrete, buildable plan. It
fills in the details the goal leaves open (stream type, component resolution,
exact `Pending` placement, error handling, packaging) and proposes a phased
build order.

---

## 1. Summary

A library that consumes a **streamed JSX string** (e.g. AI‑generated UI arriving
chunk‑by‑chunk from a server) and exposes a **live snapshot** of the parsed tree
as a React node. Any part of the tree that has not finished streaming is
represented by a `<Pending />` placeholder. Consumers read the current snapshot
and subscribe to update events; a React hook is provided on top of this.

### The core invariant

A stream is a single linear sequence of characters, so at any instant there is
exactly **one cursor position** — the boundary between "received" and
"not yet received". Therefore, while the stream is open, the snapshot contains
**exactly one `<Pending />`**, placed at that cursor and nested inside whatever
elements are currently open.

Examples (cursor = end of received input):

| Received so far          | Snapshot (React)                                  |
| ------------------------ | ------------------------------------------------- |
| `<div>`                  | `<div><Pending/></div>`                           |
| `<div>Hello`             | `<div>Hello<Pending/></div>`                      |
| `<div><span>`            | `<div><span><Pending/></span></div>`              |
| `<div><sp`               | `<div><Pending/></div>` (partial child tag hidden)|
| `<div title="bo`         | `<Pending/>` (open tag unfinished → div hidden)   |
| `<div>{`                 | `<div><Pending/></div>` (expression unfinished)   |
| `<div>a</div>` (eof)     | `<div>a</div>` (no Pending after stream ends)      |

This single‑frontier rule is the backbone of the whole design and keeps the
incremental update both correct and cheap.

---

## 2. Scope of JSX supported (per GOAL, made precise)

The parser is **not** a JavaScript parser. It recognizes a small JSX subset:

**Elements**
- Host/intrinsic elements: lowercase names (`div`, `span`, …) → passed to React
  as string tags.
- Component elements: capitalized names (`Card`, `Button`) → resolved through a
  user‑supplied `components` map / `resolveComponent`.
- Self‑closing elements: `<br />`, `<Foo />`.
- Fragments: `<>…</>`.

**Attributes / props**
- String values: `prop="foo"` and `prop='foo'`.
- Boolean shorthand: `disabled` → `disabled={true}`.
- Expression values: `prop={…}` where `…` is one of the literals below or a
  nested JSX element.

**Children**
- Text.
- Nested elements / fragments.
- Expression containers `{…}`.

**Expressions inside `{ }`** (both props and children) are limited to:
- string literals (`'…'`, `"…"`), template literals **without** substitutions
  (`` `…` ``) — optional, see open questions,
- number literals (`42`, `3.14`, `-1`, `1e3`),
- `true`, `false`, `null`, `undefined`,
- a **predefined variable** reference: a bare identifier (`user`) or dot‑notation
  member access (`user.name.first`), resolved at render time against a
  user‑supplied `variables` map — mirroring how component tags resolve through
  `components`. Every path segment is validated against the map's values at
  parse time (a path that would not resolve reports `"unknown-variable"` per
  §7); `resolveVariablePath` is the shared lookup for both. `__proto__` /
  `constructor` / `prototype` are excluded from the syntax and root names
  must be own properties of the map, so references cannot escape the
  predefined data,
- a nested JSX element/fragment.

Explicitly **out of scope**: computed/bracket member access, function
calls, arithmetic, ternaries, object/array literals, spread (`{...x}`), arrow
functions. Encountering these is a parse error handled per §7.

---

## 3. Public API

The package ships a framework‑agnostic core plus a React adapter, via subpath
exports.

### 3.1 React adapter (primary, documented API)

```ts
import { createIncrementalJsxParser } from "@ingenui/incremental-jsx-parser";

const parser = createIncrementalJsxParser(source, {
  components: { Card, Button },     // tag name -> React component
  Pending: MyPending,               // placeholder (default: renders null)
  resolveComponent,                 // optional: (name) => Component | undefined
  onUnknownComponent: "pending",    // "pending" | "skip" | "passthrough"
  onJsxError,                       // (event: JsxErrorEvent) => void
});

parser.getSnapshot();               // => React.ReactNode (stable ref until change)
const unsubscribe = parser.subscribe(() => {/* re-render */});
parser.dispose();                   // cancel the stream / detach
await parser.done;                  // resolves when stream completes (or rejects)
```

The returned object is intentionally shaped to be a drop‑in for React's
`useSyncExternalStore` (`subscribe` + `getSnapshot`, plus a `getServerSnapshot`).

### 3.2 React hook

```ts
import { useIncrementalJsx } from "@ingenui/incremental-jsx-parser/react";

function StreamedUI({ stream }: { stream: ReadableStream<Uint8Array> }) {
  return useIncrementalJsx(stream, { components: { Card, Button } });
}
```

Implemented with `useSyncExternalStore` over the parser store. Handles
parser lifecycle (create on mount / dispose on unmount, re‑create when the
source identity changes).

### 3.3 Core (framework‑agnostic)

```ts
import { createParser } from "@ingenui/incremental-jsx-parser/core";

const core = createParser();        // low-level, push-based
core.write(chunk);                  // feed a string chunk
core.end();                         // signal end of stream
core.getTree();                     // => immutable AST snapshot (plain objects)
core.subscribe(listener);
```

The core emits a renderer‑independent AST. The React adapter is a thin layer
that converts AST → `React.createElement(...)` and injects the `Pending`
component. This keeps the door open for other renderers later while satisfying
the React‑centric goal today.

### 3.4 Accepted stream sources

`source` may be:
- `ReadableStream<Uint8Array>` (decoded via `TextDecoder`, the common
  `fetch().body` case),
- `ReadableStream<string>`,
- `AsyncIterable<string | Uint8Array>`,
- or the low‑level push API (`createParser().write/end`) for callers without a
  stream object.

---

## 4. Architecture

```
            chunks
 source ──────────────► StreamDriver ──► Tokenizer ──► TreeBuilder ──► Store
 (ReadableStream/                         (resumable    (open stack +    (snapshot +
  AsyncIterable/                           state machine) frontier model)  subscribe)
  push API)                                                     │
                                                                ▼
                                                       React adapter (AST → ReactNode)
```

### 4.1 StreamDriver
Pulls from the source in a background async loop, decodes bytes to text,
forwards each chunk to the tokenizer, and after each processed chunk asks the
store to notify subscribers. On stream end → `tokenizer.end()` + finalize. On
read error → reject `done`, call `onStreamError`, keep last good snapshot.

### 4.2 Tokenizer (incremental, resumable)
A character‑level state machine that consumes as much of the current buffer as
possible and **retains partial state** across chunk boundaries (it can be cut
off mid‑tag, mid‑attribute, mid‑expression, mid‑text and resume cleanly when
more characters arrive). States:

- `TEXT` — accumulate child text until `<` or `{`.
- `TAG_OPEN` — after `<`: dispatch to name / `/` (closing) / `>` (fragment).
- `TAG_NAME`, `BEFORE_ATTR`, `ATTR_NAME`, `AFTER_ATTR_NAME`,
  `BEFORE_ATTR_VALUE`, `ATTR_VALUE_STRING`, `ATTR_VALUE_EXPR`.
- `SELF_CLOSING` — `/` before `>`.
- `CLOSING_TAG` — `</name>`.
- `EXPRESSION` — inside `{ }`; tracks brace/quote nesting and nested JSX so the
  matching `}` is found correctly.

The tokenizer emits **tokens** (e.g. `OpenTagStart`, `Attr`, `OpenTagEnd`,
`SelfClose`, `CloseTag`, `Text`, `Expr`) plus a `PartialToken` describing what,
if anything, is currently half‑read at the cursor.

### 4.3 TreeBuilder (AST + frontier)
Maintains:
- the committed AST (root is an implicit fragment / list of top‑level nodes),
- a **stack of currently open elements** (open tag fully parsed, not yet closed).

Append‑only property: streamed JSX only ever extends the currently‑open path;
once an element is closed it is **frozen** and never mutated again. This is what
makes the parser genuinely incremental rather than a re‑parse per chunk.

AST node shapes:
```ts
type Node = ElementNode | FragmentNode | TextNode | ExpressionNode;
interface ElementNode  { kind: "element"; id: number; tag: string;
                         props: Record<string, PropValue>; children: Node[];
                         status: "open" | "closed"; }
interface FragmentNode { kind: "fragment"; id: number; children: Node[];
                         status: "open" | "closed"; }
interface TextNode     { kind: "text"; id: number; value: string; }
interface ExpressionNode { kind: "expression"; id: number; value: unknown; }
```
Every node gets a monotonically increasing `id` at creation → used as a stable
React `key` so React reconciles instead of remounting as the stream grows.

### 4.4 Pending placement
Derived directly from the §1 invariant: while the stream is open, append the
`Pending` placeholder as the last child of the **top of the open stack**
(or to the root list if the stack is empty). Partial text already received in
the current open element is rendered before it; partial open‑tags / expressions
contribute nothing visible (just the trailing `Pending`). On `end()`, the
placeholder is dropped.

### 4.5 React adapter
Converts AST → React nodes:
- intrinsic tag → string; component tag → resolved component (or behavior from
  `onUnknownComponent`); fragment → `React.Fragment`.
- prop values mapped to JS values (string/number/bool/null/undefined/nested
  element).
- **Memoization**: each *closed* (frozen) node caches its created React element,
  so between snapshots only the open path + the single `Pending` are rebuilt.
  Combined with stable `key`s this gives near‑O(depth) snapshot cost and lets
  React bail out of re‑rendering settled subtrees.

### 4.6 Store
- `getSnapshot()` returns a cached React node; recomputed lazily and only when
  the tree changed since last read (version counter).
- `subscribe(listener)` / notify; updates are coalesced to **one notification
  per processed chunk** (not per character). Optional `throttleMs` /
  `scheduler` option for high‑frequency streams.
- `getServerSnapshot()` for SSR safety.

---

## 5. Stream / chunking correctness

The defining requirement: **the result must not depend on how the byte stream is
chopped into chunks.** This is enforced by the resumable tokenizer (no token
straddling a chunk boundary is ever lost) and verified by tests that feed the
same input split at *every* possible boundary (including 1‑char chunks and
multi‑byte UTF‑8 split mid‑codepoint, handled via streaming `TextDecoder`).

---

## 6. `Pending` component

- Default export `Pending` renders `null` (invisible placeholder); users
  typically pass their own (spinner, skeleton, shimmer).
- Supplied via the `Pending` option; the adapter injects it at the frontier.
- Receives no required props in v1 (a future enhancement may pass context such
  as the kind of pending construct: text vs element vs attribute).

---

## 7. Error handling & finalization

AI output is frequently malformed, so the parser is **lenient by default**:

- **Mismatched / missing close tags:** on `end()` with elements still open,
  auto‑close them (keep best‑effort content) rather than throwing.
- **Mismatched closing tag** mid‑stream (`</b>` closing an `<a>`): configurable
  recovery `mismatchedTag: "autoclose" | "ignore"` (default `"autoclose"`).
- **Unsupported expression** (e.g. `{foo()}`): render the offending expression
  as nothing and continue.
- **Read errors from the source:** unrecoverable — reject `done`, call
  `onStreamError`, retain the last good snapshot.
- The last successfully produced snapshot is always preserved; errors never
  blank the UI.
- Every recoverable (JSX-level) error above is additionally reported through
  the single structured `onJsxError` event channel, synchronously at parse
  time and independent of the recovery mode, so a stream producer (e.g. an
  agent) gets instant feedback.

On normal completion: drop the `Pending` frontier, freeze remaining open nodes,
emit a final update, resolve `done`.

---

## 8. Tooling & infrastructure

Versions checked against npm on 2026‑06‑20 (per GOAL's "check library
versions"):

| Concern        | Choice                              | Version  |
| -------------- | ----------------------------------- | -------- |
| Language       | TypeScript                          | 6.0.x    |
| Package mgr    | pnpm                                | 11.x     |
| Bundler/dts    | tsdown (rolldown‑based)             | 0.22.x   |
| Test runner    | Vitest                              | 4.x      |
| DOM env        | happy-dom                           | 20.x     |
| React testing  | @testing-library/react             | 16.x     |
| Linter         | oxlint (oxc)                        | 1.70.x   |
| Formatter      | oxfmt (oxc)                         | 0.55.x   |
| Publish checks | publint + @arethetypeswrong/cli     | 0.3 / 0.18|
| React (peer)   | react / react-dom                   | ≥18, dev 19.x |

Notes:
- **ESM‑first** output with type declarations; CJS build optional (decide via
  `attw`/`publint`). Target Node ≥20 and modern browsers/edge runtimes.
- **React is a `peerDependency`** (`>=18` for `useSyncExternalStore`; develop
  against 19). The `/core` entry has **zero** React dependency.
- `package.json` `exports` map: `.` (React adapter), `./react` (hook),
  `./core` (framework‑agnostic). `sideEffects: false`.
- `tsdown` chosen as the modern, fast, rolldown‑based successor to `tsup`;
  `tsup` 8.x is an acceptable fallback if tsdown causes friction.
- **CI** (GitHub Actions): install (pnpm), `oxlint` + `oxfmt --check`, `tsc --noEmit`,
  `vitest run`, build, `publint` + `attw` on the built package. A release
  workflow (e.g. Changesets) is added in the docs/release phase.
- A **SessionStart hook** so Claude Code on the web can install deps and run
  lint/test/typecheck automatically (see the `session-start-hook` skill).

---

## 9. Testing strategy

1. **Tokenizer unit tests** — state transitions; fed the same input as one
   chunk, as 1‑char chunks, and at randomized boundaries → identical token
   stream. Multi‑byte UTF‑8 split mid‑codepoint.
2. **Frontier/Pending snapshot tests** — one assertion per partial state from
   the §1 table, plus deeper nesting and attribute/expression frontiers.
3. **Tree builder tests** — open/close stacking, fragments, self‑closing,
   props (string, boolean shorthand, expression literals, nested JSX).
4. **React adapter tests** — component resolution, unknown‑component behavior,
   key stability (no remount across growth), closed‑node memoization (referential
   stability of frozen subtrees).
5. **Hook tests** (Testing Library) — drive a stream, assert rendered DOM
   evolves correctly and `Pending` appears/disappears.
6. **Property/fuzz tests** (`fast-check`) — generate random in‑spec JSX, split
   into random chunks, assert final snapshot equals a one‑shot parse of the full
   string (chunking invariance).
7. **Error‑handling tests** — truncated streams, mismatched tags, unsupported
   expressions, source read errors.

Coverage gate via Vitest's coverage in CI.

---

## 10. Phased build order

- **Phase 0 — Scaffold.** pnpm workspace, TS 6 config, oxlint + oxfmt, Vitest+happy-dom,
  tsdown build, `exports` map, CI, SessionStart hook. _Exit: empty package
  builds, lints, tests run._
- **Phase 1 — Incremental tokenizer.** Resumable state machine + token types +
  chunking‑invariance tests. _Exit: §5 tests pass on the tokenizer._
- **Phase 2 — Tree builder & frontier.** Open stack, append‑only AST, single
  `Pending` frontier, finalization. _Exit: §1 table reproduced as AST tests._
- **Phase 3 — React adapter.** AST → ReactNode, component resolution, keys,
  memoization, default `Pending`. _Exit: adapter + key/memo tests pass._
- **Phase 4 — Stream driver & store.** Source normalization (ReadableStream /
  AsyncIterable / push), `TextDecoder`, coalesced notifications,
  `getSnapshot/subscribe/dispose/done`. _Exit: end‑to‑end string→snapshot tests._
- **Phase 5 — Expressions in `{ }`.** Literal + nested‑JSX expression parsing
  for props and children. _Exit: §2 expression tests pass._
- **Phase 6 — React hook.** `useIncrementalJsx` via `useSyncExternalStore`,
  lifecycle, SSR snapshot. _Exit: hook tests pass._
- **Phase 7 — Errors & edge cases.** Leniency strategies, malformed input,
  truncation, fuzz suite. _Exit: §7 + §9.6/9.7 pass._
- **Phase 8 — Docs, examples, release.** README with API + a streaming demo,
  `publint`/`attw` clean, Changesets release workflow. _Exit: publishable._

---

## 11. Open questions / decisions made

Defaults chosen so work can proceed; revisit if requirements differ.

1. **Stream type** — GOAL says "a stream." Decided: accept `ReadableStream`
   (bytes or strings), `AsyncIterable`, and a push API. Web `ReadableStream` is
   the documented primary (matches `fetch().body`).
2. **Component identity** — JSX names alone can't produce components. Decided:
   user supplies a `components` map / `resolveComponent` (also serves as a
   security allowlist for untrusted AI output). Unknown → `Pending` by default.
3. **"as a string" in GOAL §JSX.2** — read as "inside `{}`, these literal values
   and nested JSX are supported," not literal stringification.
4. **Pending granularity** — exactly one `Pending` at the frontier (§1). An
   alternative (render in‑progress open tags with partial props before `>`) is
   deferred as a future enhancement for smoother attribute streaming.
5. **Template literals** — only those without `${}` substitutions; full ones are
   out of scope. Confirm if needed.
6. **Leniency vs strictness** — default lenient (auto‑close, best‑effort) since
   the input is AI‑generated; a `strict` option can flip individual behaviors.
7. **CJS output** — ESM‑first; CJS only if `publint`/`attw` indicate consumers
   need it.

---

## 12. Deliverables

- `@ingenui/incremental-jsx-parser` package: `/core`, `/` (React adapter),
  `/react` (hook).
- Test suite (unit + property + hook) and CI.
- README with API reference and a streaming example.
- Release tooling (Changesets) ready for the eventual library publish.
