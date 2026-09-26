---
"@ingenui/incremental-jsx-parser": patch
"ingenui": patch
---

Add `useIsElementComplete()`: a hook for catalog components that returns `false` while the component's element is still open on the stream and `true` once it is settled (closing tag arrived, self-closing, or auto-closed). Each resolved component element is now wrapped in a context provider, so the flag flips without remounting. Exported from `@ingenui/incremental-jsx-parser` and `/react`, and re-exported from `ingenui/react`.
