# ingenui

## 0.0.1

### Patch Changes

- c4bc8aa: Model-defined actions, on by default: the model may define its own actions
  simply by referencing them — any `actions.<name>` resolves to a notify-only
  action (no declaration syntax needed; the name is the definition).
  Undeclared names never run host code: they only emit the canonical "The
  `actions.<name>` action was fired by the user." message, with
  `declared: false` on the `ActionEvent`. Declared actions are unchanged
  (`declared: true`, local handlers still run), and `formatGenUiPrompt`
  follows the same default, telling the model it may invent action names.
  Opt out with `dynamicActions: false` to keep the action vocabulary
  host-owned — a reference outside the declared `actions` is then reported as
  an `unknown-variable` issue.
- c4bc8aa: Initial release: a lightweight Generative UI framework wrapping
  `@ingenui/incremental-jsx-parser`. Streams an AI-generated Markdown message into a
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

- Updated dependencies [e3b5492]
- Updated dependencies [feae30a]
- Updated dependencies [098477a]
- Updated dependencies [2ffb609]
- Updated dependencies [c16ebd8]
- Updated dependencies [65eafe7]
- Updated dependencies [7e3cbc3]
- Updated dependencies [38a8d65]
  - @ingenui/incremental-jsx-parser@0.0.1
