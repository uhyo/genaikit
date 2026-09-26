/**
 * React hook entry point (`@ingenui/incremental-jsx-parser/react`).
 *
 * `useIncrementalJsx` drives an {@link IncrementalJsxParser} through
 * `useSyncExternalStore`, so the component re-renders exactly when the parsed
 * tree changes (PLAN.md §3.2). The parser is created from the `source` and
 * re-created when the source identity changes; it is disposed on unmount (or
 * when the source changes), cancelling the underlying stream.
 *
 * Note: a stream source can only be consumed once. Under React StrictMode's
 * development double-invocation, pass a stable `source` (e.g. a memoized
 * `fetch().body`) so it is not consumed twice.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { createIncrementalJsxParser } from "./index";
import type { IncrementalJsxParserOptions, JsxStreamSource } from "./index";

export type { IncrementalJsxParserOptions, JsxStreamSource } from "./index";
export { useIsElementComplete } from "./render";

/**
 * Render a streamed JSX source as a live React tree. The returned node updates
 * as the stream arrives, showing the `Pending` placeholder at the frontier
 * until the stream completes.
 */
export function useIncrementalJsx(
  source: JsxStreamSource,
  options?: IncrementalJsxParserOptions,
): ReactNode {
  // Re-create only when the source identity changes; options are read once at
  // creation (changing them mid-stream is not supported).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parser = useMemo(() => createIncrementalJsxParser(source, options), [source]);

  useEffect(() => {
    // Avoid an unhandled rejection if the stream errors; errors are still
    // surfaced through the `onStreamError` option.
    parser.done.catch(() => {});
    return () => parser.dispose();
  }, [parser]);

  return useSyncExternalStore(parser.subscribe, parser.getSnapshot, parser.getServerSnapshot);
}
