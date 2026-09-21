# CLAUDE.md

Guidance for working in this repository.

## What this is

A **pnpm monorepo** hosting a Generative UI toolchain. Workspace layout:

- `packages/*` — published libraries. Currently:
  - [`packages/jsx-incremental-parser`](./packages/jsx-incremental-parser) —
    incrementally parses a **streamed JSX string** into a **live React tree**,
    rendering the not-yet-arrived part as a single `<Pending />` placeholder at
    the streaming frontier.
  - [`packages/genuikit`](./packages/genuikit) — lightweight **Generative UI
    framework** wrapping the parser: streams AI-generated **Markdown** where
    ```` ```ui+jsx ```` code fences render as live UI, with the `actions`
    convention (UI → next AI request) and structured issue feedback for the
    model.
- `apps/*` — private, unpublished apps. Currently:
  - [`apps/demo`](./apps/demo) — Vite playground that streams sample JSX and
    renders the live tree (deployable to Cloudflare Workers).

Per-package docs: the parser's original goal is
[`packages/jsx-incremental-parser/GOAL.md`](./packages/jsx-incremental-parser/GOAL.md),
the full design is
[`packages/jsx-incremental-parser/PLAN.md`](./packages/jsx-incremental-parser/PLAN.md),
and the public API is its
[`README.md`](./packages/jsx-incremental-parser/README.md).

## Monorepo conventions

- Single lockfile at the repo root; `pnpm install` there installs everything.
  Workspace members declare each other with `workspace:*`.
- **Lint/format are root-level** (`pnpm run lint` → `oxlint`, `pnpm run format`
  → `oxfmt`, configs `.oxlintrc.json` / `.oxfmtrc.json` at the root, covering
  the whole repo). Packages don't have their own lint/format scripts.
- **Typecheck/test/build are per-package**; root scripts fan out with
  `pnpm -r run <script>` (packages lacking the script are skipped). Package
  tsconfigs extend the root [`tsconfig.base.json`](./tsconfig.base.json)
  (the demo app keeps a looser standalone tsconfig).
- Target a single package with `pnpm --filter <package-name> <script>`.
- New published packages go in `packages/<name>` with their own `package.json`
  (`repository.directory` set), `tsconfig.json` extending the base, `tsdown`
  build, colocated Vitest tests, and a `LICENSE` copy. Add `publint`/`attw`
  scripts so root `pnpm run publint` / `pnpm run attw` cover them.

## Architecture: `packages/jsx-incremental-parser`

The pipeline is a chain of small, independently testable modules
(`source → tokenizer → tree builder → store → React adapter`). Paths below are
relative to `packages/jsx-incremental-parser/`:

| File | Role |
| ---- | ---- |
| `src/tokenizer.ts` | Resumable, char-level state machine. Retains partial state across chunk boundaries and emits a **chunking-invariant** token stream. Text is entity-decoded and JSX-whitespace-normalized incrementally (real-JSX semantics). `getPending()` reports the renderable frontier (partial text; a possibly-incomplete entity or unresolved whitespace is withheld until it resolves). |
| `src/tree-builder.ts` | Builds the append-only AST + open stack. Closed nodes are frozen and reused by reference; `snapshot()` overlays the single `PendingNode` frontier by cloning only the open path. Handles closing-tag mismatch (`mismatchedTag`). |
| `src/entities.ts` | HTML character-reference decoding (numeric + the named HTML4 set + `apos`), shared by text and string attribute values. Unknown references stay verbatim. Dependency-free. |
| `src/expression.ts` | Pure parser for the supported `{ }` subset (literals, predefined-variable references incl. dot-notation member access, + nested JSX — the latter two via injected callbacks). Returns `UNSUPPORTED_EXPRESSION` otherwise. Kept dependency-free to avoid an import cycle. |
| `src/schema.ts` | Element allowlist (`elements`) + the lightweight prop type system (`SchemaType`: primitives, `function`/`object`/`node`/`url`/`any`, unions, object shapes). Elements and component specs declare prop catalogs (`checkProp` validates every parsed prop, incl. component props); variables get declared types (`variableTypes`) or value-inferred ones (`resolveVariableType`). The built-in host rules (`style: "object"`, `on*: "function"`, URL props: `"url"`, blocked `dangerouslySetInnerHTML` &c.) are default declarations in the same system and can't be relaxed. Shared canonical checks — parse-time events and render-time enforcement both call them. `formatPromptContract` serializes the schema (types included) for the generating model's system prompt. React-free. |
| `src/core.ts` | Public AST types + `createParser` (push-based store, version-cached `getTree`, per-chunk notifications). **Zero React dependency.** |
| `src/stream.ts` | `pumpStream`: normalizes `ReadableStream`/`AsyncIterable` sources, decodes bytes with a streaming `TextDecoder`, supports cancellation. |
| `src/render.ts` | AST → `ReactNode`. Component resolution, node-id keys, WeakMap memoization of closed subtrees. |
| `src/index.ts` | React adapter entry (`createIncrementalJsxParser`). |
| `src/react.ts` | `useIncrementalJsx` hook (over `useSyncExternalStore`). |

### Invariants worth preserving

- **Single frontier** (PLAN §1): while the stream is open the snapshot contains
  exactly one `PendingNode`, nested in the innermost open element.
- **Chunk independence** (PLAN §5): the final result must not depend on how the
  input is split. Enforced by the resumable tokenizer and the fuzz suite.
- **Append-only / frozen closed nodes**: never mutate a closed node; this keeps
  React reconciliation cheap (stable keys + memoized subtrees).

### Deliberate v1 scope decisions

- Text follows **real JSX parser semantics** (Babel-equivalent): HTML entities
  are decoded (numeric + HTML4 named set; not the full HTML5 list) and JSX
  whitespace rules apply (indentation dropped, line breaks join with a single
  space). Both happen incrementally in the tokenizer, decode-before-normalize.
- Nested JSX *inside an expression* is buffered until its `}` (it appears at once
  rather than streaming its own inner frontier).

### Subpath exports

`.` (React adapter), `./react` (hook), `./core` (framework-agnostic, incl.
`pumpStream`). The `./core` entry must stay React-free — don't import
`react`/`render.ts` from `core.ts`, `tokenizer.ts`, `tree-builder.ts`,
`expression.ts`, `entities.ts`, or `stream.ts`.

## Architecture: `packages/genuikit`

Wraps the parser's **public API only** (root entry + `./core`); typecheck and
Vitest resolve it to the parser's source via tsconfig `paths` / a Vite alias
(same pattern as `apps/demo`), so no build step is needed first. Paths below
are relative to `packages/genuikit/`:

| File | Role |
| ---- | ---- |
| `src/splitter.ts` | Resumable Markdown / ```` ```ui+jsx ```` fence splitter. Chunking-invariant commits (per complete line); a partial trailing line is a tentative "tail" (withheld while it could still be a fence); tracks regular code fences so a `ui+jsx` opener inside one is not misread. |
| `src/channel.ts` | Single-consumer push channel; each `ui+jsx` block's extracted JSX is pushed through one into its own `createIncrementalJsxParser`. |
| `src/markdown.tsx` | Built-in safe CommonMark-subset renderer (raw HTML stays literal text, URL schemes checked). Pure/total — re-run on a growing region while streaming. Pluggable via `renderMarkdown`. |
| `src/actions.ts` | The `actions` convention: declared actions → the predefined `actions` variable (typed `"function"`), firing `ActionEvent`s with the canonical next-request `message`. |
| `src/issues.ts` | `GenUiIssue` union (`jsx-error` / `render-error` / `unclosed-fence`, all per `blockIndex`) + `formatIssueReport` (feedback text for the model). |
| `src/boundary.tsx` | Per-block error boundary; `resetKey` bumps on each parser update so a crashed block retries as the stream grows. |
| `src/message.tsx` | `createGenUiMessage`: pumps the source, drives the splitter, owns segments (cached markdown regions + per-block parsers in boundaries), collects issues, exposes a `useSyncExternalStore`-shaped store. |
| `src/prompt.ts` | `formatGenUiPrompt`: message format + actions + the parser's `formatPromptContract`. |
| `src/index.ts` / `src/react.ts` | Entries: `.` (store + helpers) and `./react` (`useGenUiMessage`, `useGenUiNode`). |

Invariants: chunk independence end-to-end (its own fuzz suite); markdown
regions keep stable element identities once settled; a crashed UI block never
takes down the message (boundary + retry); issues are the only error channel
(`onJsxError` is not exposed).

## Development

```sh
pnpm install     # at the repo root — installs the whole workspace
pnpm run check   # lint + format:check + typecheck + test (run before pushing)
pnpm test        # all package tests (vitest run per package)
pnpm run build   # build all packages
```

Tooling: TypeScript (strict), Vitest + happy-dom, oxlint + oxfmt, tsdown,
publint + attw. Each `src/*.ts(x)` has a colocated `*.test.ts(x)`; the fuzz suite
(`packages/jsx-incremental-parser/src/fuzz.test.ts`) checks chunk-independence
over generated input.

## Release flow (Changesets)

Releases are automated by [`.github/workflows/release.yml`](./.github/workflows/release.yml)
on pushes to `master`. Changesets is workspace-aware: it versions and publishes
every non-private package with pending changesets (private workspace members
like `apps/demo` are never versioned or published).

1. **In a PR that changes published behavior**, add a changeset:
   ```sh
   pnpm changeset
   ```
   Pick the affected package(s) and bump (patch/minor/major) and describe the
   change. Commit the generated `.changeset/*.md` file with the PR.
2. **On merge to `master`**, the release workflow opens (or updates) a
   "Version Packages" PR that applies the pending changesets, bumps the
   versions, and updates each package's `CHANGELOG.md`.
3. **Merging the "Version Packages" PR** publishes to npm (`changeset publish`,
   public access, with provenance).

Publishing uses **npm trusted publishing (OIDC)** — no `NPM_TOKEN` secret. The
workflow's `id-token: write` permission lets npm authenticate via OIDC. This
requires a one-time setup on npmjs.com **per package**: configure the package's
trusted publisher to this repo and the `release.yml` workflow. Provenance is
generated automatically.

Don't bump versions in `package.json` files by hand — let Changesets do it.
