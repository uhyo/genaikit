# Generative UI toolchain — live demo

An interactive playground for the workspace libraries. It streams a source
**a few characters at a time** (the way an LLM streams tokens) and renders the
resulting **live React tree** side-by-side with the raw text. Everything that
hasn't arrived yet is the single `<Pending />` frontier, shown here as a
shimmer. Two modes:

- **genuikit · Markdown + ui+jsx** (default) — streams a
  [`genuikit`](../../packages/genuikit) message: Markdown where
  ```` ```ui+jsx ```` code fences render as live, interactive UI. Clicking a
  streamed `actions.*` handler logs the canonical **next request to the AI**
  (action names are model-defined — dynamic actions, the default), and a
  malformed sample shows the **feedback report** (`getIssueReport()`) ready
  to send back to the model.
- **parser · raw JSX** — streams a bare JSX string straight into
  [`jsx-incremental-parser`](../../packages/jsx-incremental-parser).

The layout is two side-by-side panes: the **received stream** (raw text, growing
with a blinking caret) on the left, and the **live React tree** it parses into on
the right.

## What it shows

- **Incremental rendering** — settled subtrees stay put while only the open path
  and the `<Pending />` shimmer update each chunk.
- **The single frontier** — exactly one shimmer at a time: after the Markdown
  when the frontier is in prose, or nested in the innermost open element of a
  streaming UI block.
- **Lenient parsing** — the malformed samples omit close tags, reference
  unknown components, and use unsupported `{ }` expressions; the tree recovers
  and the problems surface as structured events (`onJsxError` in parser mode,
  issues + the feedback report in genuikit mode) instead of throwing.
- **Components as an allowlist** — only the components in
  [`src/components.tsx`](./src/components.tsx) can be instantiated by the streamed
  source; anything else degrades to `<Pending />`.
- **The actions loop** — `onClick={actions.addToCart}` in a sample wires a real
  click handler; firing it emits "The `actions.addToCart` action was fired by
  the user.", shown in the action log.

## Run it

The demo imports both libraries straight from the workspace source
(`../../packages/*/src`) via Vite aliases, so there's no build step — edits to
the libraries show up live.

```sh
pnpm install          # once, at the repo root
pnpm --filter jsx-incremental-parser-demo dev
```

Then open the printed URL. Pick a sample (or edit the JSX), choose a speed, and
press **Stream it**.

## Deploy (Cloudflare Workers)

The demo is a fully static SPA, so it ships as an
[assets-only Worker](https://developers.cloudflare.com/workers/static-assets/):
Cloudflare serves the built `dist/` directly, with no Worker script. The config
lives in [`wrangler.jsonc`](./wrangler.jsonc) (`not_found_handling:
"single-page-application"` rewrites unknown paths to `index.html`).

One-time auth (either works):

```sh
pnpm exec wrangler login            # interactive OAuth, or…
export CLOUDFLARE_API_TOKEN=…       # token with "Edit Workers" permission
```

Then build + publish:

```sh
pnpm install          # once, at the repo root
pnpm --filter jsx-incremental-parser-demo run deploy   # = vite build && wrangler deploy
```

Wrangler prints the live URL (`https://jsx-incremental-parser-demo.<account>.workers.dev`).
To preview the production build on the Workers runtime locally first, run
`pnpm cf:preview` (`vite build && wrangler dev`).

## How it's wired

genuikit mode:

```tsx
import { useGenUiMessage } from "genuikit/react";

const { node, message } = useGenUiMessage(stream, {
  components: demoComponents,      // allowlist + renderers for ui+jsx blocks
  Pending: Shimmer,                // frontier placeholder
  onAction: (event) => { /* event.message -> the action log */ },
  onIssue: (issue) => { /* surfaced live in the UI */ },
});
// on message.done: message.getIssueReport() -> the feedback panel
```

Parser mode:

```tsx
import { useIncrementalJsx } from "jsx-incremental-parser/react";

const node = useIncrementalJsx(stream, {
  components: demoComponents,      // allowlist + renderers
  Pending: Shimmer,               // frontier placeholder
  onUnknownComponent: "pending",
  onJsxError: (event) => { /* event.message surfaced in the UI */ },
});
```

The streamed source is a `ReadableStream<Uint8Array>` built in
[`src/streaming.ts`](./src/streaming.ts), which releases the text in small chunks
on a timer and encodes to bytes — deliberately exercising the library's
streaming `TextDecoder` path.

> The demo intentionally does **not** wrap the tree in `<StrictMode>`: a stream
> source is single-use, and StrictMode's dev double-invocation would consume it
> before the real run. The library is StrictMode-safe given a *stable* source.
