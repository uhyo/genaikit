# Generative UI toolchain

A pnpm monorepo hosting a toolchain for **Generative UI**: letting an LLM
stream UI descriptions (JSX) that render as **live React trees** while they
arrive — safely, incrementally, and without flicker.

## Packages

| Package | Description |
| ------- | ----------- |
| [`jsx-incremental-parser`](./packages/jsx-incremental-parser) | Incrementally parse a streamed JSX string into a live React snapshot, rendering not-yet-arrived parts as `<Pending />`. Framework-agnostic core + React adapter. |

## Apps

| App | Description |
| --- | ----------- |
| [`apps/demo`](./apps/demo) | Interactive playground: streams sample JSX character-by-character and renders the live React tree side-by-side with the raw text. |

## Development

```sh
pnpm install
pnpm run check   # lint + format:check + typecheck + test (run before pushing)
pnpm test        # all package tests
pnpm run build   # build all packages
```

Run a script in a single workspace package with `--filter`, e.g.:

```sh
pnpm --filter jsx-incremental-parser test
pnpm --filter jsx-incremental-parser-demo dev
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
