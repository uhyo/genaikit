/** CommonMark backtick fences, shared by the splitter and the Markdown renderer. */

/** Opening fence: up to 3 spaces, 3+ backticks, an info string without backticks. */
export const FENCE_OPEN = /^ {0,3}(`{3,})([^`]*)$/;

const FENCE_CLOSE = /^ {0,3}(`{3,})[ \t]*$/;

/** Whether `line` closes a fence opened with `size` backticks (it must be at least as long). */
export function isFenceClose(line: string, size: number): boolean {
  const close = FENCE_CLOSE.exec(line);
  return close !== null && close[1]!.length >= size;
}
