# Markdown and streaming

## Markdown support

The built-in renderer is a small, dependency-free CommonMark subset: ATX
headings, paragraphs (hard breaks via trailing double-space/backslash),
ordered/unordered lists (nested by indentation; tight lists only),
blockquotes, fenced code blocks, thematic breaks; inline
`**strong**`/`*em*`/`` `code` ``, links, images, and backslash escapes.

Safety on untrusted model output: **raw HTML renders as literal text**, link
URLs allow only `http:`/`https:`/`mailto:`/relative, and image URLs only
`http:`/`https:`/relative (`javascript:` &c. render as plain text).

Not supported (v1): setext headings, tables, loose lists, reference links,
raw HTML, `~~~` fences. Swap in your own renderer with the `renderMarkdown`
option if you need more.

## Streaming semantics

- The splitter is **chunking-invariant**: region boundaries and the text fed
  to each block's parser depend only on the input, never on how the stream is
  split (verified by a fuzz suite, like the parser's).
- Markdown re-renders as its region grows; settled regions keep stable
  element identities (cheap React reconciliation), mirroring the parser's
  frozen subtrees.
- A partial trailing line that could still become a ```` ```ui+jsx ````
  opener (or a closing fence) is withheld until it resolves, so fences never
  flash as text — and inside a block, JSX still streams character-level the
  moment a line can no longer be the closing fence.
- A ```` ```ui+jsx ```` line inside a regular code fence is not mistaken for
  an opener.
- While streaming, the message shows the `Pending` placeholder at the
  frontier: after the Markdown when the frontier is in prose, or inside the
  UI at the exact insertion point when it is in a `ui+jsx` block.
