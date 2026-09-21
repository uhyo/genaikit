# genuikit

A **lightweight Generative UI framework**: stream an AI-generated Markdown
message into a live React tree, where fenced ```` ```ui+jsx ```` code blocks
render as **interactive UI** through
[`jsx-incremental-parser`](../jsx-incremental-parser).

The model writes ordinary Markdown; wherever it wants real UI, it opens a
`ui+jsx` fence:

````markdown
Here are your options:

```ui+jsx
<Card title="Standard plan">
  <button onClick={actions.subscribe}>Subscribe</button>
</Card>
```

Let me know if you have questions!
````

genuikit renders the Markdown around it, streams the fence contents through
the incremental JSX parser (with a `<Pending />` placeholder at the streaming
frontier), and owns the three conventions that close the loop with the model:

- **The `ui+jsx` fence** — the message format. `formatGenUiPrompt` serializes
  it (plus the JSX schema) for the generating model's system prompt.
- **The `actions` variable** — UI-to-conversation bridge. The app declares
  actions; the model wires them wherever a function is expected
  (`onClick={actions.submit}`); when the user triggers one, genuikit hands the
  app the canonical next request: ``The `actions.submit` action was fired by
  the user.`` By default the model may also **define its own actions** just by
  referencing them — no declaration syntax needed (`dynamicActions: false`
  opts out).
- **Issues** — parse errors, render-time crashes (each block sits in its own
  error boundary, so an invalid UI is hidden the moment it turns out to be),
  and unclosed fences are collected per message; `getIssueReport()` formats
  them as feedback to send back to the model.

Errors never blank the message: Markdown keeps rendering, other blocks keep
working, and a crashed block is retried automatically as more of the stream
arrives (a crash caused by a temporarily-truncated tree heals itself).

> **Status:** early development (`0.0.0`). The API described here is
> implemented and tested, but may still change before a stable release.

## Install

```sh
npm install genuikit
# react is a peer dependency (>= 18); jsx-incremental-parser comes with it
```

## Quick start

```tsx
import { useGenUiMessage } from "genuikit/react";

function AssistantMessage({ stream }: { stream: ReadableStream<Uint8Array> }) {
  const { node, message } = useGenUiMessage(stream, {
    components: { Card },
    actions: {
      subscribe: () => {/* optional local handling */},
    },
    onAction: (event) => {
      // The canonical next request for the model:
      sendToModel(event.message); // "The `actions.subscribe` action was fired by the user."
    },
    Pending: () => <span className="shimmer" />,
  });

  // After the stream completes, report problems back to the model:
  useEffect(() => {
    message.done.then(() => {
      const report = message.getIssueReport();
      if (report !== null) sendToModel(report);
    });
  }, [message]);

  return <div className="message">{node}</div>;
}
```

And on the prompt side:

```ts
import { formatGenUiPrompt } from "genuikit";

const systemPrompt = `You are a helpful assistant …

${formatGenUiPrompt({
  components: { Card: { component: Card, props: { title: "string" } } },
  elements: { div: true, p: true, button: true },
  actions: { subscribe: true },
})}`;
```

`formatGenUiPrompt` explains the message format and the actions, and embeds
the parser's `formatPromptContract` (the exact JSX subset, allowed
elements/components/props with their types, and predefined variables) so the
model knows precisely what it may emit.

## API

### `createGenUiMessage(source, options?)` — `genuikit`

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

**Options** — everything `createIncrementalJsxParser` accepts (`components`,
`elements`, `variables`, `variableTypes`, `resolveComponent`,
`onUnknownComponent`, `onDisallowedElement`, `mismatchedTag`, `Pending`,
`onStreamError`; they are forwarded to every `ui+jsx` block's parser), plus:

| Option           | Type                                  | Description |
| ---------------- | ------------------------------------- | ----------- |
| `actions`        | `Record<string, ActionHandler \| true>` | The actions the model may use; exposed as the predefined variable `actions`, each entry typed `"function"`. `true` declares an action with no local handler. |
| `dynamicActions` | `boolean`                             | Let the model define its own actions by referencing them: any `actions.<name>` resolves; undeclared names are notify-only (`declared: false`). **Default `true`** — pass `false` to keep the action vocabulary host-owned. |
| `onAction`       | `(event: ActionEvent) => void`        | Fired when the user triggers an action. `event.message` is the canonical next-request text; `event.declared` distinguishes host-declared from model-defined actions. |
| `onIssue`        | `(issue: GenUiIssue) => void`         | Fired for every issue as it is found (issues also accumulate on the message). |
| `renderMarkdown` | `(markdown: string) => ReactNode`     | Replace the built-in Markdown renderer. |
| `renderUiError`  | `(blockIndex: number) => ReactNode`   | Rendered in place of a block whose UI crashed (default: nothing — the block is hidden). |

`onJsxError` is not an option here — the parser's structured errors flow into
the issue channel instead (`onIssue` / `getIssues`).

### `useGenUiMessage(source, options?)` — `genuikit/react`

React hook: creates the message from `source` (re-created when the source
identity changes, disposed on unmount) and subscribes via
`useSyncExternalStore`. Returns `{ node, message }` — the live tree plus the
store, for `done` / `getIssueReport()`.

`useGenUiNode(message)` renders a message store created elsewhere (e.g. where
the request is made, so the same code can read the issue report on
completion).

### The `actions` convention

```ts
const message = createGenUiMessage(stream, {
  actions: {
    submit: (event) => {/* runs in addition to onAction */},
    cancel: true, // no local handler; still reported through onAction
  },
  onAction: ({ name, reference, message, args }) => {
    // name: "submit", reference: "actions.submit"
    // message: "The `actions.submit` action was fired by the user."
    sendToModel(message);
  },
});
```

Under the hood each action becomes an entry of the predefined `actions`
variable (declared `"function"` in the schema), so the parser validates
references at parse time, and `onClick={actions}` (not a function) fails the
type check. The helpers (`formatActionMessage`, `createActionsVariable`) are
exported for custom setups.

#### Model-defined actions: the `dynamicActions` default

An AI-defined action carries no host behavior — all it can ever do is send
the canonical "this action was fired" message back into the conversation. So
a declaration adds nothing the reference itself doesn't already say: **the
name is the definition.** By default (`dynamicActions: true`), any
`actions.<name>` the model writes resolves to a notify-only action:

````markdown
Which plan would you like?

```ui+jsx
<div>
  <button onClick={actions.choosePlanBasic}>Basic</button>
  <button onClick={actions.choosePlanPro}>Pro</button>
</div>
```
````

Clicking "Pro" fires `onAction` with `declared: false` and the message
``The `actions.choosePlanPro` action was fired by the user.`` — the model
invented the name, so it knows what it means. Declared actions keep working
exactly as before (`declared: true`, local handler runs); an undeclared name
never runs host code, so apps switching on `event.name` should treat unknown
names as pass-through-to-the-model.

`formatGenUiPrompt` follows the same default and tells the model it may
invent action names. **Opting out:** pass `dynamicActions: false` (to both)
when the host owns the action vocabulary — then a reference outside the
declared `actions`, including a typo in a declared name, is caught as an
`unknown-variable` issue, and with no `actions` declared the variable does
not exist at all.

(Implementation note: the `actions` value becomes a `Proxy` answering for
any name, which the parser's `in`-semantics variable resolution accepts and
type-infers as `"function"` — chunk invariance and the rest of the schema
are untouched. Inherited `Object.prototype` member names like `toString`
are left alone.)

### Issues: the feedback loop

`GenUiIssue` is a discriminated union on `kind`; every issue carries the
0-based `blockIndex` of the `ui+jsx` block it belongs to (in document order):

| `kind`            | Extra fields | Meaning |
| ----------------- | ------------ | ------- |
| `"jsx-error"`     | `event: JsxErrorEvent` | A structured parse-time error from the JSX parser (unknown component/variable, unsupported expression, mismatched/unclosed tag, disallowed element, invalid prop). |
| `"render-error"`  | `error: unknown` | The block's UI **crashed while rendering** (a component threw); the error boundary hid the block. |
| `"unclosed-fence"`| —            | The stream ended before the block's closing ``` fence. |

`formatIssueReport(issues)` (also available as `message.getIssueReport()`)
renders them as one report addressed to the model, grouped per block, with
the parser's caret code frames inline — send it as (part of) the next request
and the model can correct itself:

```text
Your last message had problems in its `ui+jsx` blocks. …

In `ui+jsx` block 1:
- Unknown component <Chart> (line 2, column 3)

    2 |   <Chart data={metrics} />
      |   ^
```

### Error containment

Each `ui+jsx` block renders inside its own error boundary
(`UiBlockErrorBoundary`, exported for standalone use):

- A render-time crash hides **that block only** — the surrounding Markdown
  and other blocks are unaffected — and records a `render-error` issue.
- While the block is still streaming, every new chunk retries the block, so a
  crash caused by partially-arrived content heals itself.
- `renderUiError` supplies a fallback (an "invalid UI" note, for instance);
  by default the crashed block renders as nothing.

A failing stream *source* (network error) is separate: `onStreamError` fires
once, `done` rejects, and the content received so far stays rendered, with
open blocks finalized best-effort.

### Markdown support

The built-in renderer is a small, dependency-free CommonMark subset: ATX
headings, paragraphs (hard breaks via trailing double-space/backslash),
ordered/unordered lists (nested by indentation; tight lists only),
blockquotes, fenced code blocks, thematic breaks; inline
`**strong**`/`*em*`/`` `code` ``, links, images, and backslash escapes.

Safety on untrusted model output: **raw HTML renders as literal text**, link
URLs allow only `http:`/`https:`/`mailto:`/relative, and image URLs only
`http:`/`https:`/relative (`javascript:` &c. render as plain text).

Not supported (v1): setext headings, tables, loose lists, reference links,
raw HTML, `~~~` fences. Swap in your own renderer with `renderMarkdown` if
you need more.

### Streaming semantics

- The splitter is **chunking-invariant**: region boundaries and the text fed
  to each block's parser depend only on the input, never on how the stream is
  split (verified by a fuzz suite, like the parser's).
- Markdown re-renders as its region grows; settled regions keep stable
  element identities (cheap React reconciliation), mirroring the parser's
  frozen subtrees.
- A partial trailing line that could still become a ```` ```ui+jsx ````
  opener (or a closing fence) is withheld until it resolves, so fences never
  flash as text — and inside a block, JSX still streams character-level the
  moment a line can no longer be the closing fence.
- While streaming, the message shows the `Pending` placeholder at the
  frontier: after the Markdown when the frontier is in prose, or inside the
  UI at the exact insertion point when it is in a `ui+jsx` block.

## License

MIT © uhyo
