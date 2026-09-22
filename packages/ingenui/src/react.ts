/**
 * React hook entry point (`ingenui/react`).
 *
 * Note: a stream source can only be consumed once. Under React StrictMode's
 * development double-invocation, pass a stable `source` (e.g. a memoized
 * `fetch().body`) so it is not consumed twice.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import type { GenUiMessage, GenUiMessageOptions } from "./message";
import { createGenUiMessage } from "./message";
import type { JsxStreamSource } from "@ingenui/incremental-jsx-parser/core";

export type { GenUiMessage, GenUiMessageOptions } from "./message";

/** What {@link useGenUiMessage} returns. */
export interface GenUiMessageHook {
  /** The live React tree for the streamed message. */
  node: ReactNode;
  /** The underlying store — `message.done`, `getIssues()`, `getIssueReport()`. */
  message: GenUiMessage;
}

/**
 * Subscribe to an existing {@link GenUiMessage} and render it. Use this when
 * the message store is created outside React (e.g. where the request is
 * made, so the same code can read the issue report when it completes).
 */
export function useGenUiNode(message: GenUiMessage): ReactNode {
  return useSyncExternalStore(message.subscribe, message.getSnapshot, message.getServerSnapshot);
}

/**
 * Create a {@link GenUiMessage} from a stream source and render it. The
 * message is re-created when the `source` identity changes and disposed on
 * unmount (or when the source changes), cancelling the underlying stream.
 */
export function useGenUiMessage(
  source: JsxStreamSource,
  options?: GenUiMessageOptions,
): GenUiMessageHook {
  // Re-create only when the source identity changes; options are read once at
  // creation (changing them mid-stream is not supported).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const message = useMemo(() => createGenUiMessage(source, options), [source]);

  useEffect(() => {
    // Avoid an unhandled rejection if the stream errors; errors are still
    // surfaced through the `onStreamError` option.
    message.done.catch(() => {});
    return () => message.dispose();
  }, [message]);

  const node = useGenUiNode(message);
  return { node, message };
}
