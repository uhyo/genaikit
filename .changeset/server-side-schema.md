---
"ingenui": patch
"@ingenui/incremental-jsx-parser": patch
---

ingenui now covers the server as well as the client:

- `ingenui/schema`: `defineGenUiSchema` declares the parse-affecting options (elements, component prop catalogs with descriptions, variable types, actions, `dynamicActions`, `mismatchedTag`) as plain data, shared by the server and the client.
- `bindGenUi(schema, bindings)` (in `ingenui`) binds components, variable values and action handlers to a schema. The bindings are type-checked against the schema (`InferSchemaType` / `InferComponentProps`) and checked at runtime.
- `ingenui/server` (React-free): `pipeGenUi` validates a model's stream while passing it through to the client, reporting the client's parse-time issues as soon as they are streamed. It also exports `createGenUiValidator` / `validateGenUiMessage`, `resolveGenUiAction` (for building the next request on the server from an action name), `formatGenUiPrompt`, and `formatIssueReport`.
- `formatGenUiPrompt` accepts a schema and includes component and action descriptions. Actions may be declared as `{ description }`.

Parser: component specs accept a `description` (listed by `formatPromptContract`). The prompt contract now lists declared variables first, and a prop rejected by an empty prop catalog now reads "`<Tag>` takes no props".
