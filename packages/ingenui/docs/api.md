# API reference

- [`createGenUiMessage`](#creategenuimessagesource-options--ingenui) — the message store
- [Options](#options)
- [`useGenUiMessage` / `useGenUiNode`](#usegenuimessagesource-options--ingenuireact) — React hooks
- [`formatGenUiPrompt`](#formatgenuipromptoptions--ingenui) — the system prompt

See also: [the `actions` convention](./actions.md),
[issues and error containment](./issues.md), and
[Markdown and streaming](./markdown.md).

## `createGenUiMessage(source, options?)` — `ingenui`

The core store for **one streamed message**. Shaped as a drop-in for
`useSyncExternalStore`, like the underlying parser:

```ts
const message = createGenUiMessage(source, options);

message.getSnapshot(); // => ReactNode (stable ref until the content changes)
message.getServerSnapshot(); // SSR-safe snapshot
const unsubscribe = message.subscribe(() => {/* re-render */});
message.dispose(); // cancel the stream and detach
await message.done; // resolves when the stream and every UI block complete

message.getIssues(); // => readonly GenUiIssue[]
message.getIssueReport(); // => string | null — feedback for the model
```

**Accepted `source` types** are the parser's: `ReadableStream<Uint8Array>`
(the common `fetch().body` case), `ReadableStream<string>`, or any
`AsyncIterable<string | Uint8Array>`.

## Options

Everything `createIncrementalJsxParser` accepts (`components`, `elements`,
`variables`, `variableTypes`, `resolveComponent`, `onUnknownComponent`,
`onDisallowedElement`, `mismatchedTag`, `Pending`, `onStreamError`; see the
[parser's API reference](../../incremental-jsx-parser/docs/api.md#options)).
They are forwarded to every `ui+jsx` block's parser. In addition:

| Option           | Type                                  | Description |
| ---------------- | ------------------------------------- | ----------- |
| `actions`        | `Record<string, ActionHandler \| true>` | The actions the model may use; exposed as the predefined variable `actions`, each entry typed `"function"`. `true` declares an action with no local handler. See [the `actions` convention](./actions.md). |
| `dynamicActions` | `boolean`                             | Let the model define its own actions by referencing them: any `actions.<name>` resolves; undeclared names are notify-only (`declared: false`). **Default `true`** — pass `false` to keep the action vocabulary host-owned. |
| `onAction`       | `(event: ActionEvent) => void`        | Fired when the user triggers an action. `event.message` is the canonical next-request text; `event.declared` distinguishes host-declared from model-defined actions. |
| `onIssue`        | `(issue: GenUiIssue) => void`         | Fired for every issue as it is found (issues also accumulate on the message). See [issues](./issues.md). |
| `renderMarkdown` | `(markdown: string, context: { streaming: boolean }) => ReactNode` | Replace the built-in [Markdown renderer](./markdown.md). `streaming` is `true` while the region holds the stream's frontier. |
| `renderUiError`  | `(blockIndex: number) => ReactNode`   | Rendered in place of a block whose UI crashed (default: nothing — the block is hidden). |

`onJsxError` is not an option here — the parser's structured errors flow into
the issue channel instead (`onIssue` / `getIssues`).

## `useGenUiMessage(source, options?)` — `ingenui/react`

React hook: creates the message from `source` (re-created when the source
identity changes, disposed on unmount) and subscribes via
`useSyncExternalStore`. Returns `{ node, message }` — the live tree plus the
store, for `done` / `getIssueReport()`.

`useGenUiNode(message)` renders a message store created elsewhere (e.g. where
the request is made, so the same code can read the issue report on
completion).

## `formatGenUiPrompt(options?)` — `ingenui`

Builds the section of the generating model's system prompt that describes
the message format: how to open a `ui+jsx` fence, which actions exist (and,
unless `dynamicActions: false`, that it may invent action names), plus the
parser's `formatPromptContract` — the exact JSX subset, allowed
elements/components/props with their types, and predefined variables. Pass
it the same schema options you pass to `createGenUiMessage`:

```ts
import { formatGenUiPrompt } from "ingenui";

const systemPrompt = `You are a helpful assistant …

${formatGenUiPrompt({
  components: { Card: { component: Card, props: { title: "string" } } },
  elements: { div: true, p: true, button: true },
  actions: { subscribe: true },
})}`;
```
