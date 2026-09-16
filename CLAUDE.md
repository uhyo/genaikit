# CLAUDE.md

Guidance for working in this repository.

## What this is

`jsx-incremental-parser` incrementally parses a **streamed JSX string** into a
**live React tree**, rendering the not-yet-arrived part as a single `<Pending />`
placeholder at the streaming frontier. See [`GOAL.md`](./GOAL.md) for the
original goal, [`PLAN.md`](./PLAN.md) for the full design, and
[`README.md`](./README.md) for the public API.

## Architecture

The pipeline is a chain of small, independently testable modules
(`source → tokenizer → tree builder → store → React adapter`):

| File | Role |
| ---- | ---- |
| `src/tokenizer.ts` | Resumable, char-level state machine. Retains partial state across chunk boundaries and emits a **chunking-invariant** token stream. `getPending()` reports the renderable frontier (partial text). |
| `src/tree-builder.ts` | Builds the append-only AST + open stack. Closed nodes are frozen and reused by reference; `snapshot()` overlays the single `PendingNode` frontier by cloning only the open path. Handles closing-tag mismatch (`mismatchedTag`). |
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

- Text is kept **raw** (no JSX whitespace collapsing).
- Nested JSX *inside an expression* is buffered until its `}` (it appears at once
  rather than streaming its own inner frontier).

## Subpath exports

`.` (React adapter), `./react` (hook), `./core` (framework-agnostic). The
`./core` entry must stay React-free — don't import `react`/`render.ts` from
`core.ts`, `tokenizer.ts`, `tree-builder.ts`, `expression.ts`, or `stream.ts`.

## Development

```sh
pnpm install
pnpm run check   # lint + format:check + typecheck + test (run before pushing)
pnpm test        # vitest run
pnpm run build   # tsdown (ESM + d.ts)
```

Tooling: TypeScript (strict), Vitest + happy-dom, oxlint + oxfmt, tsdown,
publint + attw. Each `src/*.ts(x)` has a colocated `*.test.ts(x)`; the fuzz suite
(`src/fuzz.test.ts`) checks chunk-independence over generated input.

## Release flow (Changesets)

Releases are automated by [`.github/workflows/release.yml`](./.github/workflows/release.yml)
on pushes to `master`.

1. **In a PR that changes published behavior**, add a changeset:
   ```sh
   pnpm changeset
   ```
   Pick the bump (patch/minor/major) and describe the change. Commit the
   generated `.changeset/*.md` file with the PR.
2. **On merge to `master`**, the release workflow opens (or updates) a
   "Version Packages" PR that applies the pending changesets, bumps the version,
   and updates `CHANGELOG.md`.
3. **Merging the "Version Packages" PR** publishes to npm (`changeset publish`,
   public access, with provenance).

Publishing uses **npm trusted publishing (OIDC)** — no `NPM_TOKEN` secret. The
workflow's `id-token: write` permission lets npm authenticate via OIDC. This
requires a one-time setup on npmjs.com: configure the package's trusted
publisher to this repo and the `release.yml` workflow. Provenance is generated
automatically.

Don't bump the version in `package.json` by hand — let Changesets do it.
