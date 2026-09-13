/**
 * Incremental, resumable JSX tokenizer (PLAN.md §4.2).
 *
 * A character-level state machine that consumes as much of each chunk as it can
 * and **retains partial state across chunk boundaries**: it can be cut off
 * mid-tag, mid-attribute, or mid-text and resume cleanly when more characters
 * arrive. The key correctness property (PLAN.md §5) is that the emitted token
 * stream does not depend on how the input is split into chunks.
 *
 * The tokenizer additionally exposes {@link Tokenizer.getPending}, describing
 * the half-read construct at the cursor. Only partial *text* is renderable; a
 * partial tag/attribute contributes nothing visible (it is hidden until it
 * completes), which is what the frontier model in PLAN.md §1 relies on.
 *
 * Expression containers (`{ ... }`) are handled in Phase 5; this phase covers
 * text, elements, fragments, attributes (string + boolean shorthand),
 * self-closing tags, and closing tags.
 */

/**
 * A location in the streamed source, attached to the tokens (and, through
 * them, the `JsxErrorEvent`s) that can anchor an error message.
 *
 * `column` and `offset` count UTF-16 code units, matching JavaScript string
 * indexing. `lineText` is the content of the source line as far as it had
 * streamed when the construct completed — for a single-line construct that is
 * the whole line up to and including it; the tail of the line may not have
 * arrived yet. Very long lines are truncated at {@link MAX_LINE_TEXT}.
 */
export interface SourceLocation {
  /** 1-based line number. */
  line: number;
  /** 1-based column (UTF-16 code units). */
  column: number;
  /** 0-based offset from the start of the stream (UTF-16 code units). */
  offset: number;
  /** Content of the line, as streamed so far when captured (no newline). */
  lineText: string;
}

/** The value of an attribute. */
export type AttrValue =
  | { type: "string"; value: string }
  /** Boolean shorthand: `disabled` desugars to `disabled={true}`. */
  | { type: "boolean" }
  /** Expression value `attr={...}`; `raw` is the inner source, `loc` the `{`. */
  | { type: "expression"; raw: string; loc: SourceLocation };

/** A completed token emitted by the tokenizer. */
export type Token =
  /** Start of an opening tag; `name` is `""` for a fragment (`<>`). `loc` is the `<`. */
  | { type: "openTagStart"; name: string; loc: SourceLocation }
  | { type: "attribute"; name: string; value: AttrValue }
  /** `>` terminating an opening tag (the element becomes "open"). `loc` is the `>`. */
  | { type: "openTagEnd"; loc: SourceLocation }
  /** `/>` terminating a self-closing element. `loc` is the `>`. */
  | { type: "selfClose"; loc: SourceLocation }
  /** A closing tag; `name` is `""` for a fragment close (`</>`). `loc` is the `<`. */
  | { type: "closeTag"; name: string; loc: SourceLocation }
  /** A complete run of child text. */
  | { type: "text"; value: string }
  /** A complete child expression container `{...}`; `raw` is the inner source, `loc` the `{`. */
  | { type: "expr"; raw: string; loc: SourceLocation };

/** The half-read construct at the cursor; see PLAN.md §1. */
export type Partial =
  /** Nothing renderable is pending (idle, or mid-tag/-attribute). */
  | { type: "none" }
  /** A run of child text accumulated so far but not yet terminated. */
  | { type: "text"; value: string };

const enum State {
  Text,
  TagOpen,
  TagName,
  BeforeAttrName,
  AttrName,
  AfterAttrName,
  BeforeAttrValue,
  AttrValueString,
  SelfClose,
  CloseTagName,
  CloseTagEnd,
  Expression,
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

function isNameStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isNameChar(ch: string): boolean {
  return isNameStart(ch) || (ch >= "0" && ch <= "9") || ch === "-" || ch === ".";
}

/** Cap on retained per-line context, so a pathological single line stays bounded. */
const MAX_LINE_TEXT = 500;

/**
 * The recorded start of a construct (`<` of a tag, `{` of an expression) that
 * may later anchor a token's {@link SourceLocation}. `lineText` stays `null`
 * while the anchor's line is still streaming and is snapshotted when the line
 * ends, so a construct spanning lines still reports its *starting* line.
 */
interface Anchor {
  line: number;
  column: number;
  offset: number;
  lineText: string | null;
}

/**
 * A resumable JSX tokenizer. Feed chunks with {@link write}, signal the end of
 * the stream with {@link end}, and read the current frontier with
 * {@link getPending}.
 */
export class Tokenizer {
  private state: State = State.Text;
  /** Accumulated child text (State.Text). */
  private text = "";
  /** Accumulated tag name (open or close). */
  private name = "";
  /** Accumulated attribute name. */
  private attrName = "";
  /** Accumulated attribute string value. */
  private attrValue = "";
  /** The quote character opening the current attribute string. */
  private quote = "";
  /** When true, the current character is re-processed in the new state. */
  private reconsume = false;

  // --- Source position tracking (for SourceLocation on tokens) ---
  /** 1-based line of the character currently being processed. */
  private line = 1;
  /** 1-based column (UTF-16 code units) of the current character. */
  private column = 1;
  /** 0-based offset (UTF-16 code units) of the current character. */
  private offset = 0;
  /** Content of the current line so far (capped at {@link MAX_LINE_TEXT}). */
  private lineText = "";
  /** Start of the tag currently being scanned (its `<`). */
  private tagAnchor: Anchor | null = null;
  /** Start of the expression currently being scanned (its `{`). */
  private exprAnchor: Anchor | null = null;

  // --- Expression container (`{ ... }`) scanning state ---
  /** Accumulated raw expression source (between the outer braces). */
  private exprRaw = "";
  /** Brace nesting depth; 0 means the matching `}` has been found. */
  private exprDepth = 0;
  /** The quote currently open inside the expression (`` empty if none). */
  private exprQuote = "";
  /** True if the next expression char is escaped (inside a string). */
  private exprEscape = false;
  /** True if this expression is an attribute value (vs a child). */
  private exprIsAttr = false;
  /** The attribute name when {@link exprIsAttr}. */
  private exprAttrName = "";

  /** Feed a string chunk; returns the tokens completed by this chunk. */
  write(chunk: string): Token[] {
    const out: Token[] = [];
    for (const ch of chunk) {
      // The line buffer includes the current character *before* it is
      // processed, so a token emitted on a delimiter (`>`, `}`) captures a
      // `lineText` that contains the whole construct.
      if (ch !== "\n" && ch !== "\r" && this.lineText.length < MAX_LINE_TEXT) {
        this.lineText += ch;
      }
      do {
        this.reconsume = false;
        this.step(ch, out);
      } while (this.reconsume);
      this.offset += ch.length;
      if (ch === "\n") {
        this.finishLine();
        this.line++;
        this.column = 1;
      } else {
        this.column += ch.length;
      }
    }
    return out;
  }

  /** Snapshot the completed line into any anchor still waiting for it. */
  private finishLine(): void {
    if (this.tagAnchor && this.tagAnchor.lineText === null) {
      this.tagAnchor.lineText = this.lineText;
    }
    if (this.exprAnchor && this.exprAnchor.lineText === null) {
      this.exprAnchor.lineText = this.lineText;
    }
    this.lineText = "";
  }

  /** Record the position of the character currently being processed. */
  private anchorHere(): Anchor {
    return { line: this.line, column: this.column, offset: this.offset, lineText: null };
  }

  /** Turn an anchor (or, defensively, the cursor) into a token location. */
  private materialize(anchor: Anchor | null): SourceLocation {
    if (!anchor) {
      return { line: this.line, column: this.column, offset: this.offset, lineText: this.lineText };
    }
    return {
      line: anchor.line,
      column: anchor.column,
      offset: anchor.offset,
      lineText: anchor.lineText ?? this.lineText,
    };
  }

  private takeTagLoc(): SourceLocation {
    const loc = this.materialize(this.tagAnchor);
    this.tagAnchor = null;
    return loc;
  }

  private takeExprLoc(): SourceLocation {
    const loc = this.materialize(this.exprAnchor);
    this.exprAnchor = null;
    return loc;
  }

  /**
   * Signal end of input. Flushes any trailing text run. Incomplete tags or
   * attributes are discarded (they never became renderable); richer recovery
   * arrives in Phase 7.
   */
  end(): Token[] {
    const out: Token[] = [];
    if (this.state === State.Text && this.text.length > 0) {
      out.push({ type: "text", value: this.text });
      this.text = "";
    }
    return out;
  }

  /** The half-read construct at the cursor (PLAN.md §1). */
  getPending(): Partial {
    if (this.state === State.Text && this.text.length > 0) {
      return { type: "text", value: this.text };
    }
    return { type: "none" };
  }

  private emitBooleanAttr(out: Token[]): void {
    out.push({ type: "attribute", name: this.attrName, value: { type: "boolean" } });
    this.attrName = "";
  }

  private step(ch: string, out: Token[]): void {
    switch (this.state) {
      case State.Text: {
        if (ch === "<") {
          this.flushText(out);
          this.tagAnchor = this.anchorHere();
          this.state = State.TagOpen;
        } else if (ch === "{") {
          this.flushText(out);
          this.startExpression(false);
        } else {
          this.text += ch;
        }
        return;
      }

      case State.TagOpen: {
        if (ch === "/") {
          this.name = "";
          this.state = State.CloseTagName;
        } else if (ch === ">") {
          // Fragment open: `<>`.
          out.push({ type: "openTagStart", name: "", loc: this.takeTagLoc() });
          out.push({ type: "openTagEnd", loc: this.materialize(null) });
          this.state = State.Text;
        } else if (isNameStart(ch)) {
          this.name = ch;
          this.state = State.TagName;
        }
        // Otherwise (whitespace or stray char) stay lenient and ignore.
        return;
      }

      case State.TagName: {
        if (isNameChar(ch)) {
          this.name += ch;
        } else if (ch === "=") {
          // Defensive: a name char set excludes `=`; ignore leniently.
        } else {
          out.push({ type: "openTagStart", name: this.name, loc: this.takeTagLoc() });
          this.name = "";
          this.state = State.BeforeAttrName;
          this.reconsume = true;
        }
        return;
      }

      case State.BeforeAttrName: {
        if (isWhitespace(ch)) {
          // Skip.
        } else if (ch === ">") {
          out.push({ type: "openTagEnd", loc: this.materialize(null) });
          this.state = State.Text;
        } else if (ch === "/") {
          this.state = State.SelfClose;
        } else if (isNameStart(ch)) {
          this.attrName = ch;
          this.state = State.AttrName;
        }
        // Otherwise ignore.
        return;
      }

      case State.AttrName: {
        if (isNameChar(ch)) {
          this.attrName += ch;
        } else if (ch === "=") {
          this.state = State.BeforeAttrValue;
        } else if (isWhitespace(ch)) {
          // Could be a boolean attr or an `=` may still follow.
          this.state = State.AfterAttrName;
        } else {
          // `>` or `/`: boolean attr, then re-handle the delimiter.
          this.emitBooleanAttr(out);
          this.state = State.BeforeAttrName;
          this.reconsume = true;
        }
        return;
      }

      case State.AfterAttrName: {
        if (isWhitespace(ch)) {
          // Skip.
        } else if (ch === "=") {
          this.state = State.BeforeAttrValue;
        } else {
          // New attr, `>` or `/`: the previous bare name was boolean.
          this.emitBooleanAttr(out);
          this.state = State.BeforeAttrName;
          this.reconsume = true;
        }
        return;
      }

      case State.BeforeAttrValue: {
        if (isWhitespace(ch)) {
          // Skip.
        } else if (ch === '"' || ch === "'") {
          this.quote = ch;
          this.attrValue = "";
          this.state = State.AttrValueString;
        } else if (ch === "{") {
          this.startExpression(true);
        }
        // Unquoted values remain out of scope.
        return;
      }

      case State.AttrValueString: {
        if (ch === this.quote) {
          out.push({
            type: "attribute",
            name: this.attrName,
            value: { type: "string", value: this.attrValue },
          });
          this.attrName = "";
          this.attrValue = "";
          this.quote = "";
          this.state = State.BeforeAttrName;
        } else {
          this.attrValue += ch;
        }
        return;
      }

      case State.SelfClose: {
        if (ch === ">") {
          out.push({ type: "selfClose", loc: this.materialize(null) });
          this.state = State.Text;
        }
        // Lenient: ignore anything between `/` and `>`.
        return;
      }

      case State.CloseTagName: {
        if (isNameChar(ch)) {
          this.name += ch;
        } else if (ch === ">") {
          out.push({ type: "closeTag", name: this.name, loc: this.takeTagLoc() });
          this.name = "";
          this.state = State.Text;
        } else if (isWhitespace(ch)) {
          this.state = State.CloseTagEnd;
        }
        // Otherwise ignore.
        return;
      }

      case State.CloseTagEnd: {
        if (ch === ">") {
          out.push({ type: "closeTag", name: this.name, loc: this.takeTagLoc() });
          this.name = "";
          this.state = State.Text;
        }
        // Skip whitespace / ignore stray chars.
        return;
      }

      case State.Expression: {
        if (this.exprQuote) {
          // Inside a string/template literal: copy verbatim, honoring escapes,
          // so braces and quotes within it do not affect nesting.
          this.exprRaw += ch;
          if (this.exprEscape) this.exprEscape = false;
          else if (ch === "\\") this.exprEscape = true;
          else if (ch === this.exprQuote) this.exprQuote = "";
          return;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          this.exprQuote = ch;
          this.exprRaw += ch;
          return;
        }
        if (ch === "{") {
          this.exprDepth++;
          this.exprRaw += ch;
          return;
        }
        if (ch === "}") {
          this.exprDepth--;
          if (this.exprDepth === 0) {
            this.finishExpression(out);
            return;
          }
          this.exprRaw += ch;
          return;
        }
        this.exprRaw += ch;
        return;
      }
    }
  }

  private flushText(out: Token[]): void {
    if (this.text.length > 0) {
      out.push({ type: "text", value: this.text });
      this.text = "";
    }
  }

  private startExpression(isAttr: boolean): void {
    this.exprAnchor = this.anchorHere();
    this.exprRaw = "";
    this.exprDepth = 1;
    this.exprQuote = "";
    this.exprEscape = false;
    this.exprIsAttr = isAttr;
    this.exprAttrName = isAttr ? this.attrName : "";
    this.state = State.Expression;
  }

  private finishExpression(out: Token[]): void {
    if (this.exprIsAttr) {
      out.push({
        type: "attribute",
        name: this.exprAttrName,
        value: { type: "expression", raw: this.exprRaw, loc: this.takeExprLoc() },
      });
      this.attrName = "";
      this.state = State.BeforeAttrName;
    } else {
      out.push({ type: "expr", raw: this.exprRaw, loc: this.takeExprLoc() });
      this.state = State.Text;
    }
    this.exprRaw = "";
    this.exprAttrName = "";
  }
}
