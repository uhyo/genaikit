/**
 * The prompt direction of the loop: serialize the ingenui conventions — the
 * Markdown + `ui+jsx` fence format, the `actions` convention, and the JSX
 * schema (via the parser's `formatPromptContract`) — into text for the system
 * prompt of the generating model. Pair it with `getIssueReport()` for the
 * feedback direction.
 */

import type { PromptContractOptions } from "@ingenui/incremental-jsx-parser";
import { formatPromptContract } from "@ingenui/incremental-jsx-parser";

import type { ActionsDefinition } from "./actions";
import { withActionsVariable } from "./actions";

export interface GenUiPromptOptions extends PromptContractOptions {
  /**
   * The actions available to the model (same value as
   * `GenUiMessageOptions.actions`). Described in the prompt and merged into
   * the predefined variables as `actions` (each entry typed `"function"`).
   */
  actions?: ActionsDefinition;
  /**
   * Same value as `GenUiMessageOptions.dynamicActions` (default `true`): tell
   * the model it may define its own actions by referencing `actions.<name>`
   * with any name. Pass `false` when the runtime opts out too.
   */
  dynamicActions?: boolean;
}

/**
 * Format the system-prompt section describing how to write a ingenui
 * message: Markdown with embedded `ui+jsx` blocks, the available actions,
 * and the exact JSX subset/schema the blocks must follow.
 */
export function formatGenUiPrompt(options: GenUiPromptOptions = {}): string {
  const { actions, dynamicActions } = options;
  const dynamic = dynamicActions !== false;

  const lines: string[] = [
    "Your messages are rendered as Markdown with embedded interactive UI.",
    "",
    "## Message format",
    "- Write the message in Markdown (headings, paragraphs, lists, blockquotes,",
    "  code fences, **strong**, *emphasis*, `code`, links). Raw HTML is not rendered.",
    "- To show interactive UI, write a fenced code block whose info string is exactly",
    "  `ui+jsx`:",
    "",
    "  ```ui+jsx",
    "  <div>…</div>",
    "  ```",
    "",
    '- Everything inside a ui+jsx fence renders as live UI; the "UI contract" section',
    "  below applies to its contents. Any other fenced code block (```js, …) is",
    "  displayed as code, never rendered as UI.",
    "- Always close every ui+jsx fence with ``` on its own line.",
  ];

  const actionNames = Object.keys(actions ?? {});
  if (actionNames.length > 0 || dynamic) {
    lines.push(
      "",
      "## Actions",
      "- The predefined variable `actions` connects the UI back to this conversation.",
    );
    if (actionNames.length > 0) {
      lines.push(
        `- Available actions: ${actionNames.map((name) => `\`actions.${name}\``).join(", ")}.`,
      );
    }
    if (dynamic) {
      lines.push(
        "- You may also define your own actions: use `actions.<name>` with any",
        "  descriptive camelCase name — no declaration is needed, and each distinct",
        "  name is a distinct action.",
      );
    }
    const example = actionNames[0] ?? "submitForm";
    lines.push(
      `- Pass one wherever a function prop is expected: onClick={actions.${example}}.`,
      "- When the user triggers one, the next user message reports it, e.g.:",
      `  "The \`actions.${example}\` action was fired by the user."`,
    );
  }

  lines.push("", "## UI contract", formatPromptContract(withActionsVariable(options)));

  return lines.join("\n");
}
