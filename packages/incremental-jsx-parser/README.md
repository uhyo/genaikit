# @ingenui/incremental-jsx-parser

Incrementally parse a **streamed JSX string** into a **live React tree**.

As JSX text arrives chunk-by-chunk (for example, AI-generated UI streaming from
a server), this library keeps a snapshot of the parsed tree up to date. Whatever
has not finished streaming yet is represented by a single `<Pending />`
placeholder at the streaming frontier, so you can render a spinner, skeleton, or
shimmer exactly where the next content will appear:

| Received so far    | Snapshot                               |
| ------------------ | -------------------------------------- |
| `<div>Hello`       | `<div>Hello<Pending/></div>`           |
| `<div><span>`      | `<div><span><Pending/></span></div>`   |
| `<div>a</div>` eof | `<div>a</div>`                         |

## Highlights

- **Incremental & cheap** — settled subtrees are frozen and reused; only the
  open path and the single `Pending` are rebuilt per chunk.
- **Chunk-independent** — the result never depends on how the byte/character
  stream happens to be split (verified by fuzz tests).
- **Lenient by design** — malformed or truncated AI output degrades gracefully
  instead of throwing, and errors never blank the UI.
- **Safe for untrusted output** — a small JSX subset (no arbitrary
  JavaScript), with components, elements, props, and variables allowlisted
  and type-checked by a lightweight schema.
- **Built for the model loop** — the schema serializes into a prompt contract,
  and structured, located errors fire at parse time to feed back to the model.
- **Framework-agnostic core** — the `/core` entry has zero React dependency.

> **Status:** early development. The API is implemented and tested, but may
> still change before a stable release.

## Install

```sh
npm install @ingenui/incremental-jsx-parser
# react / react-dom are peer dependencies (>= 18)
```

## Usage

```tsx
import { useIncrementalJsx } from "@ingenui/incremental-jsx-parser/react";

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

The hook re-renders only when the parsed tree changes and disposes the stream
on unmount. Unknown components don't render; recoverable problems are
reported through `onJsxError`.

## Documentation

- [Streaming model and supported JSX](./docs/streaming.md) — the single
  frontier, and the exact JSX subset that is recognized.
- [API reference](./docs/api.md) — `useIncrementalJsx`,
  `createIncrementalJsxParser`, and all options.
- [The schema](./docs/schema.md) — the prop type system, built-in host prop
  rules, and `formatPromptContract`.
- [Error handling](./docs/errors.md) — leniency, `onJsxError` events, and
  `formatJsxError`.
- [Framework-agnostic core](./docs/core.md) — `createParser`, the schema
  helpers, and `pumpStream`.

## License

MIT © uhyo
