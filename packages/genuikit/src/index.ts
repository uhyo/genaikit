/**
 * genuikit — a lightweight Generative UI framework (`genuikit`).
 *
 * Streams an AI-generated **Markdown** message into a live React tree, where
 * fenced ```ui+jsx code blocks render as interactive UI through
 * `jsx-incremental-parser`. Owns three conventions on top of the parser:
 *
 * - **`ui+jsx` fences** — the message format (`createGenUiMessage`,
 *   `formatGenUiPrompt`);
 * - **`actions`** — the predefined variable connecting UI events back to the
 *   conversation (`GenUiMessageOptions.actions` / `onAction`);
 * - **issues** — parse errors, render crashes (contained per block by an
 *   error boundary), and unclosed fences, collected and formatted as feedback
 *   for the model (`getIssueReport`).
 *
 * The React hook lives in `genuikit/react`.
 */

export { createGenUiMessage } from "./message";
export type { GenUiMessage, GenUiMessageOptions } from "./message";

export { formatGenUiPrompt } from "./prompt";
export type { GenUiPromptOptions } from "./prompt";

export { createActionsVariable, formatActionMessage } from "./actions";
export type {
  ActionEvent,
  ActionHandler,
  ActionListener,
  ActionsDefinition,
  ActionsVariable,
} from "./actions";

export { formatIssueReport } from "./issues";
export type { GenUiIssue, IssueListener } from "./issues";

export { renderMarkdown } from "./markdown";

export { UiBlockErrorBoundary } from "./boundary";
export type { UiBlockErrorBoundaryProps } from "./boundary";

// Re-exported from jsx-incremental-parser for convenience: the types most
// genuikit options are written in terms of.
export { formatJsxError } from "jsx-incremental-parser";
export type {
  ComponentEntry,
  ComponentSpec,
  ElementAllowlist,
  JsxErrorEvent,
  JsxStreamSource,
  SchemaType,
} from "jsx-incremental-parser";
