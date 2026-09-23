# ingenui

> Pronounced **in-JEN-you-ee** — a prefix of _ingenuity_ that contains _GenUI_.

A **lightweight Generative UI framework**: stream an AI-generated Markdown
message into a live React tree, where fenced ```` ```ui+jsx ```` code blocks
render as **interactive UI** through
[`@ingenui/incremental-jsx-parser`](../incremental-jsx-parser).

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

## Highlights

- **Just Markdown** — no tool calls or custom protocol; the model writes prose
  and drops in UI wherever it helps. The UI streams in live, with a
  `<Pending />` placeholder at the exact insertion point.
- **Interactive via `actions`** — the model wires `onClick={actions.submit}`;
  when the user clicks, you get the canonical next request for the model
  (``The `actions.submit` action was fired by the user.``). The model can even
  invent its own action names — the name is the definition.
- **Self-correcting** — parse errors, render crashes, and unclosed fences are
  collected as issues and formatted into a feedback report for the model.
- **Errors never blank the message** — each UI block sits in its own error
  boundary; Markdown and other blocks keep working, and a block that crashed
  on partially-streamed content retries as more arrives.
- **Safe for untrusted output** — allowlisted components/elements, typed
  props, and a built-in Markdown renderer that never renders raw HTML.
- **Prompt included** — `formatGenUiPrompt` tells the model the message
  format, the actions, and the exact JSX it may emit.

> **Status:** early development. The API is implemented and tested, but may
> still change before a stable release.

## Install

```sh
npm install ingenui
# react is a peer dependency (>= 18); @ingenui/incremental-jsx-parser comes with it
```

## Usage

Render a streamed message:

```tsx
import { useGenUiMessage } from "ingenui/react";

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

And tell the model how to write one:

```ts
import { formatGenUiPrompt } from "ingenui";

const systemPrompt = `You are a helpful assistant …

${formatGenUiPrompt({
  components: { Card: { component: Card, props: { title: "string" } } },
  elements: { div: true, p: true, button: true },
  actions: { subscribe: true },
})}`;
```

## Documentation

- [API reference](./docs/api.md) — `createGenUiMessage`, options,
  `useGenUiMessage` / `useGenUiNode`, and `formatGenUiPrompt`.
- [The `actions` convention](./docs/actions.md) — declared and model-defined
  actions, and `dynamicActions`.
- [Issues and error containment](./docs/issues.md) — the issue kinds, the
  feedback report, and per-block error boundaries.
- [Markdown and streaming](./docs/markdown.md) — the supported Markdown
  subset, its safety rules, and streaming semantics.
- The JSX side (supported syntax, schema, prop types) is documented in
  [`@ingenui/incremental-jsx-parser`](../incremental-jsx-parser).

## License

MIT © uhyo
