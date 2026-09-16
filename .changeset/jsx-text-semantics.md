---
"jsx-incremental-parser": minor
---

Text now follows real JSX parser semantics (Babel/TypeScript) instead of being kept raw:

- **HTML character references are decoded** — numeric (`&#65;`, `&#x1F600;`) and the named HTML4 set plus `&apos;` — in child text and in string attribute values. Unknown or malformed references stay verbatim, and a decoded `<` or `{` is text, not markup.
- **JSX whitespace rules apply to text** — tabs become spaces, indentation and whitespace-only lines around child elements are dropped, whitespace at the end of a non-final line is trimmed, and a line break inside text collapses to a single joining space. Whitespace within a single line (including a run's leading/trailing spaces on that line) is kept, as in real JSX.

Both behaviors are chunk-independent and streaming-aware: an entity or line break split across chunks resolves identically however the stream is chunked, and the pending text frontier withholds a possibly-incomplete entity (`&am…`) or not-yet-resolved whitespace until its fate is known.
