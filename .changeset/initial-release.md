---
"jsx-incremental-parser": minor
---

Initial release: incrementally parse a streamed JSX string into a live React
tree, rendering the not-yet-arrived part as a single `<Pending />` placeholder at
the streaming frontier.

- React hook (`useIncrementalJsx`) and store (`createIncrementalJsxParser`).
- Framework-agnostic, push-based core (`createParser`) with zero React dependency.
- Resumable, chunk-independent tokenizer; append-only AST with memoized,
  referentially-stable closed subtrees.
- Supported JSX subset: host/component elements, fragments, self-closing tags,
  string/boolean/expression attributes, and `{ }` expressions (string/template
  literals without substitutions, numbers, `true`/`false`/`null`/`undefined`,
  and nested JSX).
- Lenient error handling (auto-close, configurable `mismatchedTag`).
