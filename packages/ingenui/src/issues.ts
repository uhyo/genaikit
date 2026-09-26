/**
 * Issue collection and the feedback direction of the loop.
 *
 * A {@link GenUiIssue} is anything that went wrong with a `ui+jsx` block in a
 * streamed message: a structured parse-time error from the JSX parser, a
 * render-time crash caught by the block's error boundary, or a fence the
 * model never closed. {@link formatIssueReport} turns the collected issues
 * into one plain-text report to send back to the generating model, so it can
 * correct itself on the next turn.
 */

import type { JsxErrorEvent } from "@ingenui/incremental-jsx-parser/core";
import { formatJsxError } from "@ingenui/incremental-jsx-parser/core";

/** A problem found in a `ui+jsx` block. `blockIndex` is 0-based, in document order. */
export type GenUiIssue =
  | {
      /** A recoverable JSX-level parse error reported by the parser. */
      kind: "jsx-error";
      blockIndex: number;
      event: JsxErrorEvent;
    }
  | {
      /**
       * The block's UI crashed while rendering (a component threw); the error
       * boundary hid the block.
       */
      kind: "render-error";
      blockIndex: number;
      error: unknown;
    }
  | {
      /** The stream ended before the block's closing ``` fence. */
      kind: "unclosed-fence";
      blockIndex: number;
    };

export type IssueListener = (issue: GenUiIssue) => void;

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function describeIssue(issue: GenUiIssue): string {
  switch (issue.kind) {
    case "jsx-error":
      return formatJsxError(issue.event);
    case "render-error":
      return `Rendering crashed: ${describeError(issue.error)}\nThe block was hidden from the user.`;
    case "unclosed-fence":
      return "The ```ui+jsx code fence was never closed; close it with ``` on its own line.";
  }
}

const indent = (text: string): string =>
  text
    .split("\n")
    .map((line) => (line === "" ? line : `  ${line}`))
    .join("\n");

/**
 * Format the collected issues as one report addressed to the generating
 * model, ready to send as (part of) the next request. Returns `null` when
 * there is nothing to report.
 */
export function formatIssueReport(issues: readonly GenUiIssue[]): string | null {
  if (issues.length === 0) return null;

  const byBlock = new Map<number, GenUiIssue[]>();
  for (const issue of issues) {
    const list = byBlock.get(issue.blockIndex);
    if (list) list.push(issue);
    else byBlock.set(issue.blockIndex, [issue]);
  }

  const lines: string[] = [
    "Your last message had problems in its `ui+jsx` blocks. The UI may have",
    "rendered incompletely for the user. Follow the UI contract and avoid",
    "these issues from now on:",
  ];
  for (const [blockIndex, blockIssues] of [...byBlock.entries()].toSorted((a, b) => a[0] - b[0])) {
    lines.push("", `In \`ui+jsx\` block ${blockIndex + 1}:`);
    for (const issue of blockIssues) {
      const [first = "", ...rest] = describeIssue(issue).split("\n");
      lines.push(`- ${first}`);
      if (rest.length > 0) lines.push(indent(rest.join("\n")));
    }
  }
  return lines.join("\n");
}
