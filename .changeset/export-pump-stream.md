---
"jsx-incremental-parser": patch
---

Export the `pumpStream` stream driver (and its `StreamSink` / `StreamHandle` /
`JsxStreamSource` types) from the `./core` entry, so framework adapters built
on the core can reuse the same source normalization (byte/string
`ReadableStream`s and `AsyncIterable`s, streaming `TextDecoder`, cancellation)
as the React adapter.
