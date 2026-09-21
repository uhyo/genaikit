/**
 * The prompt direction of the loop: serialize the genuikit conventions — the
 * Markdown + `ui+jsx` fence format, the `actions` convention, and the JSX
 * schema (via the parser's `formatPromptContract`) — into text for the system
 * prompt of the generating model. Pair it with `getIssueReport()` for the
 * feedback direction.
 */

import type { PromptContractOptions, SchemaType } from "jsx-incremental-parser";
import { formatPromptContract } from "jsx-incremental-parser";

import type { ActionsDefinition } from "./actions";

export interface GenUiPromptOptions extends PromptContractOptions {
  /**
   * The actions available to the model (same value as
   * `GenUiMessageOptions.actions`). Described in the prompt and merged into
   * the predefined variables as `actions` (each entry typed `"function"`).
   */
  actions?: ActionsDefinition;
}

/**
 * Format the system-prompt section describing how to write a genuikit
 * message: Markdown with embedded `ui+jsx` blocks, the available actions,
 * and the exact JSX subset/schema the blocks must follow.
 */
export function formatGenUiPrompt(options: GenUiPromptOptions = {}): string {
  const { actions, variables, variableTypes, ...contract } = options;

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
  if (actionNames.length > 0) {
    lines.push(
      "",
      "## Actions",
      "- The predefined variable `actions` connects the UI back to this conversation.",
      `- Available actions: ${actionNames.map((name) => `\`actions.${name}\``).join(", ")}.`,
      `- Pass one wherever a function prop is expected: onClick={actions.${actionNames[0]}}.`,
      "- When the user triggers one, the next user message reports it, e.g.:",
      `  "The \`actions.${actionNames[0]}\` action was fired by the user."`,
    );
  }

  // Merge the actions into the contract's predefined variables, exactly as
  // createGenUiMessage merges them into the parser's.
  const mergedVariables = actions ? { ...variables, actions: {} } : variables;
  const actionsType: SchemaType = Object.fromEntries(actionNames.map((name) => [name, "function"]));
  const mergedTypes = actions ? { ...variableTypes, actions: actionsType } : variableTypes;

  lines.push(
    "",
    "## UI contract",
    formatPromptContract({
      ...contract,
      ...(mergedVariables !== undefined && { variables: mergedVariables }),
      ...(mergedTypes !== undefined && { variableTypes: mergedTypes }),
    }),
  );

  return lines.join("\n");
}
