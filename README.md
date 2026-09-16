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
| `components`         | `Record<string, ComponentType \| ComponentSpec>`    | —              | Component catalog: Capitalized tag names to React components, optionally with a declared prop catalog (`{ component, props }`). |
| `variables`          | `Record<string, unknown>`                           | —              | Values for `{name}` / `{name.member}` variable expressions.      |
| `variableTypes`      | `Record<string, SchemaType>`                        | —              | Declared variable types; refine (or stand in for) the values.    |
| `resolveComponent`   | `(name) => ComponentType \| undefined`              | —              | Resolver consulted before `components`.                           |
| `Pending`            | `ComponentType`                                      | renders `null` | Placeholder rendered at the frontier.                             |
| `onUnknownComponent` | `"pending" \| "skip" \| "passthrough"`              | `"pending"`    | How to *render* an unresolved component tag.                      |
| `elements`           | `string[] \| Record<string, true \| string[] \| PropTypes>` | all allowed | Allowlist of intrinsic (lowercase) tags, optionally with per-tag prop allowlists or prop types. |
| `onDisallowedElement`| `"skip" \| "pending"`                               | `"skip"`       | How to *render* an intrinsic tag rejected by `elements`.          |
| `mismatchedTag`      | `"autoclose" \| "ignore"`                           | `"autoclose"`  | How to *repair* a closing tag that doesn't match the open element. |
| `onJsxError`         | `(event: JsxErrorEvent) => void`                    | —              | Recoverable errors: unified structured JSX-level events, fired at parse time. |
| `onStreamError`      | `(error: unknown) => void`                          | —              | Unrecoverable errors: the stream source failed (`done` rejects too). |

The `components` map also acts as a **security allowlist** for untrusted
AI-generated output — unknown components do not render by default. The
`variables` map works the same way for `{name}` expressions, and because it
holds the actual values, **every segment** of a dot path is validated against
them at parse time: `{user.nmae}` fires an `"unknown-variable"` event the
moment it is parsed and renders as nothing (a path covered by a
`variableTypes` declaration also counts as known). Lookup uses `in` semantics
(prototype chain included; primitives are boxed, so `{title.length}` on a
string resolves), and a member behind a `null`/`undefined` value is reported
rather than crashing anything. References can never escape the predefined
data: `__proto__`, `constructor`, and `prototype` are excluded from the
syntax at any path position (they parse as an unsupported expression), and
root names must be **own** properties of the map, so inherited
`Object.prototype` members like `{toString}` never resolve.

### The schema: a lightweight type system

The schema is a small, declarative type language shared by elements,
components, and variables. A **`SchemaType`** is one of:

- `"string"`, `"number"`, `"boolean"` — primitives (literals or variable
  references);
- `"function"` — only a variable reference can supply one
  (`onClick={actions.confirm}`);
- `"object"` — any object, via a variable reference (`style={theme.card}`);
- `"node"` — renderable content: nested JSX, or a string/number/boolean;
- `"url"` — a string used as a URL; a literal must not carry an unsafe
  scheme (`javascript:`, `vbscript:`, `data:text/html`, control characters
  stripped), while a variable reference is your own data and is only checked
  to be string-typed;
- `"any"` — anything (the implicit type when only prop *names* are listed);
- a union: `["string", "number"]`;
- an object shape: `{ name: "string", age: "number" }` (walked along dot
  paths; matches wherever `"object"` is expected).

**Elements** (`elements`) allowlist intrinsic (lowercase) tags; each tag maps
to `true` (any prop), a list of allowed prop names, or prop name → type:

```ts
createIncrementalJsxParser(stream, {
  elements: { div: true, p: true, a: { href: "url", title: "string" }, img: ["src", "alt"] },
  // or just: elements: ["div", "p", "a", "img"]
});
```

A tag outside the list is reported at parse time (`kind:
"disallowed-element"`) and rendered per `onDisallowedElement` — `"skip"`
(default: renders nothing, subtree included) or `"pending"`. A prop outside a
tag's declaration, or whose value fails its declared type, is reported
(`kind: "invalid-prop"`) and dropped.

**Components** declare their prop catalog by wrapping the component in a
spec — an entry in `components` is either the component itself or
`{ component, props }`:

```ts
createIncrementalJsxParser(stream, {
  components: {
    Card: { component: Card, props: { title: "string", tone: ["string", "number"], onAction: "function" } },
    Chart, // no declaration: props are the component author's contract
  },
});
```

With a declaration, every parsed prop on that component — string attributes
and `{ }` expressions alike — is validated the same way as element props.

**Variables** get their types inferred from the `variables` values, and
`variableTypes` can declare them explicitly (declared types win; a variable
declared only by type still counts as known):

```ts
createIncrementalJsxParser(stream, {
  variables: { user, theme, actions },
  variableTypes: { user: { name: "string" }, theme: "object", actions: { confirm: "function" } },
});
```

So `<Card title={user.name}>` passes, while `onClick={user.name}` is
rejected: the reference resolves to a string where a `"function"` was
declared.

Whether or not a schema is configured, **built-in host prop rules** always
apply to intrinsic tags — they are default declarations in the same type
system, and a user schema can tighten but never relax them. They exist
because AI output frequently contains props that would make React throw
(breaking the "errors never blank the UI" promise) or that are unsafe on
untrusted input; each violation is dropped from the rendered output and
reported as `"invalid-prop"`:

- `dangerouslySetInnerHTML`, `srcDoc`, `ref`, `key`, and `children` are never
  allowed (checked case-insensitively).
- `on*` event handlers are `"function"`-typed: they must reference a
  predefined variable resolving to a function — `onClick={actions.confirm}`
  wires the actual function from `variables`, which is also the idiomatic
  way to give AI-generated UI interactivity. String handlers (`onclick="…"`)
  are rejected.
- `style` is `"object"`-typed: it must be a predefined variable resolving to
  an object (`style={theme.card}`); string styles would make React throw.
- URL props (`href`, `src`, `action`, …) are `"url"`-typed.

Component tags without a declaration are exempt from all prop rules — their
props are the component author's contract.

### The schema as a prompt contract: `formatPromptContract`

The same maps that enforce the schema describe it, so you can hand the model
the exact subset it is allowed to produce. `formatPromptContract` serializes
the configured schema — syntax subset, allowed elements/props with their
declared types, available components with their prop catalogs, predefined
variables (declared types or shallow value shapes only, never values) — into
text for the system prompt of the generating model:

```ts
import { formatPromptContract } from "jsx-incremental-parser";

const schema = {
  components: { Card: { component: Card, props: { title: "string" } }, Button },
  variables: { user, actions: { confirm: onConfirm } },
  variableTypes: { actions: { confirm: "function" } },
  elements: { div: true, p: true, a: { href: "url" } },
};

const systemPrompt = `You generate UI for …\n\n${formatPromptContract(schema)}`;
const parser = createIncrementalJsxParser(stream, {
  ...schema,
  onJsxError: (e) => agent.report(formatJsxError(e)),
});
```

Together with `onJsxError` + `formatJsxError` this closes the loop: the
contract tells the model what it may emit, and the events tell it what it
got wrong.

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
adapter. The schema helpers are exported here too (they are React-free):
`isElementAllowed(elements, tag)` and `checkProp(tag, prop, value,
{ elements, components, variables, variableTypes })` implement the canonical
checks (with `checkPropValue` / `resolveVariableType` as the underlying type
primitives) — wire them into `isAllowedElement` / `checkProp` for parse-time
`"disallowed-element"` / `"invalid-prop"` events, and apply the same helpers
in your renderer so reporting and enforcement agree (that is exactly what
the React adapter does). `formatPromptContract` is exported here as well. Since the core
knows nothing about React components, pass
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
| `"disallowed-element"`     | `tag`                       | An intrinsic (lowercase) tag rejected by the `elements` allowlist.                               |
| `"invalid-prop"`           | `tag`, `prop`, `reason`     | A prop rejected by the schema (declared prop catalog/types or built-in host rules); the renderer drops it. |

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
