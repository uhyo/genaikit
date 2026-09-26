# Server and client: the shared schema

A real AI app has three actors, and the model's output flows through all of
them:

```text
[LLM provider] ──stream──▶ [your server] ──stream──▶ [client]
```

ingenui covers both of your sides. The glue is the **GenUI schema**: the
parse-affecting half of the options as plain, JSON-serializable data. Both
sides import the same schema:

- the **server** builds the system prompt from it, validates the model's
  stream against it while passing the stream through, and builds the next
  request itself;
- the **client** binds the implementations (components, variable values,
  action handlers) to it and renders.

The server and the client run the same checks on the same text, so they
report the same issues.

- [The schema — `ingenui/schema`](#the-schema--ingenuischema)
- [The client — `bindGenUi`](#the-client--bindgenui-ingenui)
- [The server — `ingenui/server`](#the-server--ingenuiserver)
- [Building the next request on the server](#building-the-next-request-on-the-server)
- [Sharing the schema](#sharing-the-schema)

## The schema — `ingenui/schema`

```ts
// genui-schema.ts — imported by the server and the client
import { defineGenUiSchema } from "ingenui/schema";

export const schema = defineGenUiSchema({
  elements: { div: true, p: true, button: { onClick: "function" } },
  components: {
    Card: { props: { title: "string" }, description: "A titled panel for related content." },
    PlanPicker: { props: { plans: "object", onPick: "function" } },
    Chart: true, // any props, no description
  },
  variableTypes: { user: { name: "string", plan: "string" } },
  actions: { subscribe: { description: "Start a subscription." }, cancel: true },
  dynamicActions: true, // the default: the model may also invent action names
  mismatchedTag: "autoclose", // the default
});
```

| Field            | Description |
| ---------------- | ----------- |
| `elements`       | The intrinsic-element allowlist, as in the [parser's schema](../../incremental-jsx-parser/docs/schema.md#elements). |
| `components`     | The component catalog: name → `{ props?, description? }` (`true` = any props). `props` is the [prop catalog](../../incremental-jsx-parser/docs/schema.md#components); `description` is shown to the model. |
| `variableTypes`  | The predefined variables' [types](../../incremental-jsx-parser/docs/schema.md#types). The server only knows these types, so declare object shapes fully: a member missing from the declaration is an unknown variable on the server. |
| `actions`        | The declared [actions](./actions.md): name → `true` or `{ description? }`. |
| `dynamicActions` | [Model-defined actions](./actions.md#model-defined-actions-the-dynamicactions-default) (default `true`). |
| `mismatchedTag`  | Closing-tag mismatch recovery (`"autoclose"` / `"ignore"`). |

The rule for what goes where: anything that changes **parse results** is in
the schema. Options that only affect **rendering** (`Pending`,
`onUnknownComponent`, `onDisallowedElement`, `renderMarkdown`,
`renderUiError`) stay client-side.

`defineGenUiSchema` does nothing at runtime. At the type level it keeps the
literal shape, which is what lets `bindGenUi` check the bindings.
`ingenui/schema` is React-free.

## The client — `bindGenUi` (`ingenui`)

`bindGenUi(schema, bindings)` attaches the implementations and returns the
schema-derived options for [`createGenUiMessage` /
`useGenUiMessage`](./api.md). Spread them next to the client-only options:

```tsx
import { bindGenUi } from "ingenui";
import { useGenUiMessage } from "ingenui/react";
import { schema } from "./genui-schema";

const genUi = bindGenUi(schema, {
  components: { Card, PlanPicker, Chart },
  variables: { user }, // one value per declared variable
  actions: { subscribe: () => openCheckout() }, // optional handlers for declared actions
});

function AssistantMessage({ stream }: { stream: ReadableStream<Uint8Array> }) {
  const { node } = useGenUiMessage(stream, { ...genUi, Pending: Shimmer, onAction, onIssue });
  return <div className="message">{node}</div>;
}
```

The bindings are checked against the schema:

- **At the type level**, each component must accept the props the schema
  lets the model pass. `{ title: "string" }` requires
  `ComponentType<{ title?: string; children?: ReactNode }>`. Every declared
  prop is **optional**, because the model may omit any of them. Variable
  values must match their declared types. `InferSchemaType` /
  `InferComponentProps` are exported for your own typings.
- **At runtime**, `bindGenUi` throws when a declared component or variable
  has no binding, or when a binding is not declared in the schema. The model
  is only ever told about the schema.

## The server — `ingenui/server`

A React-free entry, for any runtime with Web Streams (Node 20+, Deno, Bun,
Cloudflare Workers, …). It imports only the parser's `/core`.

### `formatGenUiPrompt(schema)`

The same [prompt builder](./api.md#formatgenuipromptoptions--ingenui),
taking the schema directly. Component and action descriptions are included:

```ts
import { formatGenUiPrompt } from "ingenui/server";

const system = `You are a helpful assistant …\n\n${formatGenUiPrompt(schema)}`;
```

### `pipeGenUi(source, schema, options?)`

Validates the model's stream while passing it through unchanged:

```ts
import { pipeGenUi } from "ingenui/server";

const llmStream = await callTheModel({ system, messages }); // the provider's text stream
const pipe = pipeGenUi(llmStream, schema, {
  onIssue: (issue) => log(issue), // fires as soon as each issue is streamed
});
pipe.done.then((issues) => saveForNextTurn(issues));
return new Response(pipe.stream, { headers: { "content-type": "text/plain; charset=utf-8" } });
```

- `source` accepts what the client accepts: a `ReadableStream` of bytes or
  strings, or any `AsyncIterable` of either, such as an SDK's text-delta
  iterator.
- `pipe.stream` is the text, UTF-8 encoded, ready to be a response body.
  It is **pull-based**: the source is read (and validated) as the stream is
  consumed. Cancelling it, for example when the client disconnects, cancels
  the source.
- `onIssue` fires **synchronously inside the chunk that completes the
  problem**, before that chunk is forwarded to the client.
- `pipe.done` resolves with all issues once the source has been streamed
  through, and rejects if the source fails. If the consumer cancels first, it
  resolves with the issues found so far; end-of-message checks such as
  unclosed fences are skipped. `getIssues()` / `getIssueReport()` read the
  current state at any time.

Only `render-error` issues can't be found here: they need the real
components, so only the client sees them. Every `jsx-error` and
`unclosed-fence` the client will report, the server reports too, and for
any chunking on either side (a fuzz suite checks this).

### `createGenUiValidator(schema, options?)` / `validateGenUiMessage(text, schema)`

The validator underneath `pipeGenUi`. It is push-based (`write`, `end`,
`getIssues`, `getIssueReport`, plus `onIssue`) for wiring into your own
stream handling. `validateGenUiMessage` is the one-shot form, for stored
messages, tests and evals.

## Building the next request on the server

The previous message's feedback and the "action was fired" message both end
up in the model's next request. **Build them on the server** from structured
client input, not from text the client sends:

```ts
import { formatIssueReport, resolveGenUiAction, validateGenUiMessage } from "ingenui/server";

// The client sends { action: event.name, renderErrors: [{ blockIndex, message }] }
function nextUserTurn(previousMessage: string, action: string | undefined, renderErrors) {
  const parts: string[] = [];
  if (action !== undefined) {
    const resolved = resolveGenUiAction(schema, action); // null: not an action the model could wire
    if (resolved === null) throw new BadRequest();
    parts.push(resolved.message); // "The `actions.subscribe` action was fired by the user."
  }
  const report = formatIssueReport([
    ...validateGenUiMessage(previousMessage, schema), // or the issues saved from pipeGenUi
    ...renderErrors.map(({ blockIndex, message }) => ({ kind: "render-error", blockIndex, error: message })),
  ]);
  if (report !== null) parts.push(report);
  return parts.join("\n\n");
}
```

`resolveGenUiAction(schema, name)` accepts:

- declared actions;
- with dynamic actions, any valid `actions.<name>` member.

It rejects non-identifiers, `__proto__` / `constructor` / `prototype`, and
inherited `Object.prototype` names such as `toString`.

## Sharing the schema

### A shared module (the default)

The schema is plain data, so one module can be imported by both your server
code and your client bundle. Nothing client-side gets pulled into the
server: `ingenui/schema` and `ingenui/server` never import React. This works
with any stack: a Vite SPA plus an API route, Remix, Next.js, Hono,
Workers, … React Server Components are not required. The
[demo](../../../apps/demo) is built this way.

### A per-request schema with React Server Components (a pattern)

Sometimes the schema depends on the request: admins get extra actions, or
`variableTypes` reflect the signed-in user's data. The prompt, the validator
and the client must then all use **the same** per-request schema. With RSC,
a Server Component can compute it once and pass it down. The schema is JSON,
so it crosses the server/client boundary as an ordinary prop:

```tsx
// app/chat/page.tsx — a Server Component
export default async function ChatPage() {
  const user = await currentUser();
  const schema = defineGenUiSchema({
    ...baseSchema,
    actions: user.isAdmin ? { ...baseSchema.actions, refund: true } : baseSchema.actions,
  });
  // The route handler that calls the model derives the same schema from the
  // same request, for formatGenUiPrompt and pipeGenUi.
  return <Chat schema={schema} />;
}
```

```tsx
// Chat.tsx
"use client";
export function Chat({ schema }: { schema: GenUiSchema }) {
  const genUi = useMemo(() => bindGenUi(schema, { components, variables }), [schema]);
  // … useGenUiMessage(stream, { ...genUi, Pending, onAction })
}
```

With a schema computed at runtime, `bindGenUi` can't type-check the
bindings against the literal shape, but the runtime checks still apply.
Keep the static shape in a shared module and narrow it per request, as
above.

### Keeping deployments in sync

If the server and the client are deployed separately, a client bundle can
briefly run against a newer server, with a different schema. Treat the
schema like an API contract: add components and actions before you start
prompting with them, and remove them only after clients stop using them.
