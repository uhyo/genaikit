# ingenui

## 0.0.2

### Patch Changes

- ebfc21a: Add `useIsElementComplete()`: a hook for catalog components that returns `false` while the component's element is still open on the stream and `true` once it is settled (closing tag arrived, self-closing, or auto-closed). Each resolved component element is now wrapped in a context provider, so the flag flips without remounting. Exported from `@ingenui/incremental-jsx-parser` and `/react`, and re-exported from `ingenui/react`.
- 7ea2f79: Internal refactoring: the parser's AST primitives and error events move into dependency-free modules (no more import cycles), and duplicated logic (component resolution, fence parsing, `actions` variable wiring) is shared. `IncrementalJsxParserOptions` fields now also accept an explicit `undefined`, and `GenUiMessage` extends `IncrementalJsxParser`. With `dynamicActions: false` and an empty `actions` map, the `actions` variable is no longer defined (matching the prompt).
- a60f3da: ingenui now covers the server as well as the client:
  
  - `ingenui/schema`: `defineGenUiSchema` declares the parse-affecting options (elements, component prop catalogs with descriptions, variable types, actions, `dynamicActions`, `mismatchedTag`) as plain data, shared by the server and the client.
  - `bindGenUi(schema, bindings)` (in `ingenui`) binds components, variable values and action handlers to a schema. The bindings are type-checked against the schema (`InferSchemaType` / `InferComponentProps`) and checked at runtime.
  - `ingenui/server` (React-free): `pipeGenUi` validates a model's stream while passing it through to the client, reporting the client's parse-time issues as soon as they are streamed. It also exports `createGenUiValidator` / `validateGenUiMessage`, `resolveGenUiAction` (for building the next request on the server from an action name), `formatGenUiPrompt`, and `formatIssueReport`.
  - `formatGenUiPrompt` accepts a schema and includes component and action descriptions. Actions may be declared as `{ description }`.
  
  Parser: component specs accept a `description` (listed by `formatPromptContract`). The prompt contract now lists declared variables first, and a prop rejected by an empty prop catalog now reads "`<Tag>` takes no props".
- d6c196e: Render unterminated inline Markdown optimistically while streaming: at the stream frontier, `**bold`, `*em`, and `` `code `` show as formatted text instead of raw markers, link destinations are hidden until complete, and trailing markers that could still become syntax are withheld. Emphasis now follows CommonMark flanking rules (`** not bold **` stays literal). Custom `renderMarkdown` functions receive a `{ streaming }` context, and the exported `renderMarkdown` accepts `{ streaming: true }`.
- Updated dependencies [ebfc21a]
- Updated dependencies [7ea2f79]
- Updated dependencies [a60f3da]
  - @ingenui/incremental-jsx-parser@0.0.2

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
