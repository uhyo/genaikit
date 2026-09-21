/**
 * Incremental Markdown / `ui+jsx` fence splitter.
 *
 * Splits a streamed Markdown document into alternating **markdown** and
 * **ui** regions, where a ui region is the contents of a fenced code block
 * whose info string is exactly `ui+jsx`:
 *
 * ~~~
 * Some *markdown* text.
 *
 * ```ui+jsx
 * <Card title="hi" />
 * ```
 *
 * More markdown.
 * ~~~
 *
 * Design goals, mirroring the JSX parser it feeds:
 *
 * - **Chunking-invariant commits.** Region boundaries and the committed text
 *   of each region depend only on complete lines (plus end-of-stream), never
 *   on how the stream is chunked. A partial line is exposed separately as a
 *   *tentative tail* (`markdownTail`) so it can be rendered eagerly and
 *   replaced when the line completes.
 * - **Eager UI streaming.** Inside a ui block, a partial line is pushed to
 *   the JSX sink character-by-character as soon as it can no longer be the
 *   closing fence, so the JSX parser's frontier advances within a line.
 * - **Fence-aware.** A regular fenced code block in the markdown (```js …)
 *   is tracked so a `ui+jsx` opener *inside* it (e.g. documentation showing
 *   the syntax) is not mistaken for a real UI block.
 *
 * Only backtick fences are recognized (CommonMark also allows `~~~`; that is
 * out of the v1 subset). A closing fence must be at least as long as its
 * opener, per CommonMark.
 */

export interface FenceSplitterHandlers {
  /** Committed markdown text — append-only within the current markdown region. */
  markdown(text: string): void;
  /**
   * The current markdown region's tentative tail (a partial line that may
   * still change — or turn out to be a `ui+jsx` fence opener, in which case
   * it never becomes markdown). Replaces the previously reported tail.
   */
  markdownTail(tail: string): void;
  /** A `ui+jsx` fence opened; a new UI block begins (and a markdown region ended). */
  openUi(): void;
  /** JSX source text for the currently open UI block. */
  ui(text: string): void;
  /**
   * The current UI block ended. `terminated` is false when the stream ended
   * before the closing fence was seen.
   */
  closeUi(terminated: boolean): void;
}

export interface FenceSplitter {
  write(chunk: string): void;
  /** Finish the stream: the pending partial line is processed as a final line. */
  end(): void;
}

const UI_INFO = "ui+jsx";
/** Opening fence for a UI block: up to 3 spaces, 3+ backticks, `ui+jsx`. */
const UI_OPEN = /^ {0,3}(`{3,})[ \t]*ui\+jsx[ \t]*$/;
/** Any backtick code fence opener (CommonMark: info must not contain `` ` ``). */
const FENCE_OPEN = /^ {0,3}(`{3,})([^`]*)$/;
/** Closing fence: up to 3 spaces, backticks, trailing blanks only. */
const FENCE_CLOSE = /^ {0,3}(`{3,})[ \t]*$/;

/** Could `line` (a partial line) still grow into a `ui+jsx` fence opener? */
function isUiOpenPrefix(line: string): boolean {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  if (i > 3) return false;
  if (i === line.length) return true; // spaces only so far
  const backtickStart = i;
  while (i < line.length && line[i] === "`") i++;
  const backticks = i - backtickStart;
  if (backticks === 0) return false; // first real character is not a backtick
  if (i === line.length) return true; // backtick run may still grow
  if (backticks < 3) return false; // run ended before three backticks
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  const rest = line.slice(i);
  if (UI_INFO.startsWith(rest)) return true; // partial (or empty) info string
  if (!rest.startsWith(UI_INFO)) return false;
  return /^[ \t]*$/.test(rest.slice(UI_INFO.length));
}

/**
 * Could `line` (a partial line) still grow into a closing fence of at least
 * `size` backticks?
 */
function isFenceClosePrefix(line: string, size: number): boolean {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  if (i > 3) return false;
  if (i === line.length) return true;
  const backtickStart = i;
  while (i < line.length && line[i] === "`") i++;
  const backticks = i - backtickStart;
  if (backticks === 0) return false;
  if (i === line.length) return true; // run may still grow
  if (backticks < size) return false; // run ended too short
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return i === line.length;
}

type Mode =
  | { kind: "markdown" }
  // Inside a regular fenced code block within the markdown.
  | { kind: "markdown-fence"; size: number }
  | { kind: "ui"; size: number };

export function createFenceSplitter(handlers: FenceSplitterHandlers): FenceSplitter {
  let mode: Mode = { kind: "markdown" };
  /** The current line, as far as it has arrived (never contains `\n`). */
  let line = "";
  /** (ui mode) Whether `line` has already been flushed to the `ui` sink. */
  let lineFlushed = false;
  let lastTail = "";
  let ended = false;

  const emitTail = (): void => {
    const tail =
      mode.kind === "ui" || (mode.kind === "markdown" && isUiOpenPrefix(line)) ? "" : line;
    if (tail !== lastTail) {
      lastTail = tail;
      handlers.markdownTail(tail);
    }
  };

  /** Append partial-line text (no `\n` inside). */
  const appendPartial = (text: string): void => {
    if (text === "") return;
    if (mode.kind === "ui") {
      if (lineFlushed) {
        handlers.ui(text);
        return;
      }
      line += text;
      if (!isFenceClosePrefix(line, mode.size)) {
        handlers.ui(line);
        lineFlushed = true;
        line = "";
      }
      return;
    }
    line += text;
  };

  /**
   * The current line is complete. `eof` marks the final, unterminated line at
   * end of stream (committed without a trailing newline).
   */
  const completeLine = (eof: boolean): void => {
    const full = line;
    const flushed = lineFlushed;
    line = "";
    lineFlushed = false;
    const nl = eof ? "" : "\n";

    if (mode.kind === "ui") {
      // A line that was flushed early can no longer be a closing fence.
      const close = flushed ? null : FENCE_CLOSE.exec(full);
      if (close && close[1]!.length >= mode.size) {
        mode = { kind: "markdown" };
        handlers.closeUi(true);
        return;
      }
      handlers.ui(flushed ? nl : full + nl);
      return;
    }

    if (mode.kind === "markdown-fence") {
      const close = FENCE_CLOSE.exec(full);
      if (close && close[1]!.length >= mode.size) mode = { kind: "markdown" };
      handlers.markdown(full + nl);
      return;
    }

    const uiOpen = UI_OPEN.exec(full);
    if (uiOpen) {
      mode = { kind: "ui", size: uiOpen[1]!.length };
      if (lastTail !== "") {
        lastTail = "";
        handlers.markdownTail("");
      }
      handlers.openUi();
      return;
    }
    const fenceOpen = FENCE_OPEN.exec(full);
    if (fenceOpen) mode = { kind: "markdown-fence", size: fenceOpen[1]!.length };
    handlers.markdown(full + nl);
  };

  return {
    write(chunk) {
      if (ended) return;
      let rest = chunk;
      for (;;) {
        const nl = rest.indexOf("\n");
        if (nl === -1) {
          appendPartial(rest);
          break;
        }
        appendPartial(rest.slice(0, nl));
        completeLine(false);
        rest = rest.slice(nl + 1);
      }
      emitTail();
    },
    end() {
      if (ended) return;
      ended = true;
      if (line !== "" || lineFlushed) completeLine(true);
      if (lastTail !== "") {
        lastTail = "";
        handlers.markdownTail("");
      }
      if (mode.kind === "ui") {
        mode = { kind: "markdown" };
        handlers.closeUi(false);
      }
    },
  };
}
