# API reference

- [`useIncrementalJsx`](#useincrementaljsxsource-options--ingenuiincremental-jsx-parserreact) — React hook
- [`createIncrementalJsxParser`](#createincrementaljsxparsersource-options--ingenuiincremental-jsx-parser) — React store
- [Options](#options)
- [Components and variables as allowlists](#components-and-variables-as-allowlists)

See also: [the schema](./schema.md), [error handling](./errors.md), and
[the framework-agnostic core](./core.md).

## `useIncrementalJsx(source, options?)` — `@ingenui/incremental-jsx-parser/react`

React hook returning the live `ReactNode`. It subscribes via
`useSyncExternalStore` (re-rendering only when the parsed tree changes),
re-creates the parser when `source` identity changes, and disposes it on
unmount.

## `createIncrementalJsxParser(source, options?)` — `@ingenui/incremental-jsx-parser`

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

## Options

Accepted by both `useIncrementalJsx` and `createIncrementalJsxParser`:

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

The schema-related options (`components` specs, `elements`, `variableTypes`)
are described in [the schema](./schema.md); the error options in
[error handling](./errors.md).

## Components and variables as allowlists

The `components` map also acts as a **security allowlist** for untrusted
AI-generated output — unknown components do not render by default. The
`variables` map works the same way for `{name}` expressions, and because it
holds the actual values, **every segment** of a dot path is validated against
them at parse time: `{user.nmae}` fires an `"unknown-variable"` event the
moment it is parsed and renders as nothing (a path covered by a
`variableTypes` declaration also counts as known).

Lookup uses `in` semantics (prototype chain included; primitives are boxed,
so `{title.length}` on a string resolves), and a member behind a
`null`/`undefined` value is reported rather than crashing anything.
References can never escape the predefined data: `__proto__`, `constructor`,
and `prototype` are excluded from the syntax at any path position (they parse
as an unsupported expression), and root names must be **own** properties of
the map, so inherited `Object.prototype` members like `{toString}` never
resolve.
