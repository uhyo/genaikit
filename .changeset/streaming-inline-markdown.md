---
"ingenui": patch
---

Render unterminated inline Markdown optimistically while streaming: at the stream frontier, `**bold`, `*em`, and `` `code `` show as formatted text instead of raw markers, link destinations are hidden until complete, and trailing markers that could still become syntax are withheld. Emphasis now follows CommonMark flanking rules (`** not bold **` stays literal). Custom `renderMarkdown` functions receive a `{ streaming }` context, and the exported `renderMarkdown` accepts `{ streaming: true }`.
