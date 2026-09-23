# ingenui: Generative UI Framework

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/ingenui-lockup-dark.svg">
  <img src="./assets/ingenui-lockup.svg" alt="ingenui logo" width="480">
</picture>

A pnpm monorepo hosting a toolchain for **Generative UI**: letting an LLM
stream UI descriptions (JSX) that render as **live React trees** while they
arrive — safely, incrementally, and without flicker.

## Packages

| Package | Description |
| ------- | ----------- |
| [`@ingenui/incremental-jsx-parser`](./packages/incremental-jsx-parser) | Incrementally parse a streamed JSX string into a live React snapshot, rendering not-yet-arrived parts as `<Pending />`. Framework-agnostic core + React adapter. |
| [`ingenui`](./packages/ingenui) | Lightweight Generative UI framework (pronounced **in-JEN-you-ee**) on top of the parser: stream AI-generated Markdown where ```` ```ui+jsx ```` code fences render as live UI, with an `actions` convention for interactivity and structured error feedback for the model. |

## Apps

| App | Description |
| --- | ----------- |
| [`apps/demo`](./apps/demo) | Interactive playground with two modes: stream an ingenui Markdown message (```` ```ui+jsx ```` fences render as live, interactive UI with an action log and feedback report) or raw JSX, side-by-side with the received text. |

## Development

```sh
pnpm install
pnpm run check   # lint + format:check + typecheck + test (run before pushing)
pnpm test        # all package tests
pnpm run build   # build all packages
```

Run a script in a single workspace package with `--filter`, e.g.:

```sh
pnpm --filter @ingenui/incremental-jsx-parser test
pnpm --filter ingenui-demo dev
```

Linting (`oxlint`) and formatting (`oxfmt`) run once from the repo root and
cover the whole workspace; typecheck, tests, and builds run per package via
`pnpm -r`.

## Releases

Versioning and publishing are automated with
[Changesets](https://github.com/changesets/changesets) — see the release notes
in each package and [`.github/workflows/release.yml`](./.github/workflows/release.yml).
When a PR changes published behavior, add a changeset (`pnpm changeset`) and
commit the generated `.changeset/*.md` file.

## License

[MIT](./LICENSE)
