---
"genuikit": patch
---

Initial release: a lightweight Generative UI framework wrapping
`jsx-incremental-parser`. Streams an AI-generated Markdown message into a
live React tree, rendering fenced ```ui+jsx code blocks as interactive UI.

- `createGenUiMessage` store + `useGenUiMessage` / `useGenUiNode` React hooks.
- Chunking-invariant Markdown / `ui+jsx` fence splitter; built-in safe
  Markdown subset renderer (pluggable via `renderMarkdown`).
- The `actions` convention: declared actions become the predefined `actions`
  variable (typed `"function"`); triggering one emits the canonical
  next-request message ("The `actions.submit` action was fired by the user.").
- Issue collection and feedback: JSX parse errors, render-time crashes
  (contained per block by an error boundary with streaming retry), and
  unclosed fences, formatted for the model by `getIssueReport()` /
  `formatIssueReport`.
- `formatGenUiPrompt`: serializes the message format, actions, and the JSX
  schema contract for the generating model's system prompt.
