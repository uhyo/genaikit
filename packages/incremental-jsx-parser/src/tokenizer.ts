/**
 * Incremental, resumable JSX tokenizer (PLAN.md §4.2).
 *
 * A character-level state machine that retains partial state across chunk
 * boundaries: it can be cut off mid-tag, mid-attribute, or mid-text and resume
 * cleanly when more characters arrive. The key correctness property
 * (PLAN.md §5) is that the emitted token stream does not depend on how the
 * input is split into chunks.
 *
 * Text matches real JSX parser semantics (Babel/TypeScript), applied
 * incrementally:
 *  - HTML character references (`&amp;`, `&#x1F600;`, …) are decoded in text
 *    and in string attribute values; invalid ones stay verbatim.
 *  - JSX whitespace rules: tabs become spaces, indentation and trailing
 *    whitespace around line breaks are dropped, a line break inside text
 *    collapses to a single joining space, and a whitespace-only run that
 *    contains a line break produces no text at all.
 *
 * {@link Tokenizer.getPending} describes the half-read construct at the
 * cursor. Only partial *text* is renderable; a partial tag/attribute
 * contributes nothing visible until it completes, which is what the frontier
 * model in PLAN.md §1 relies on. A possible entity (`&am…`) and whitespace
 * whose fate depends on what follows are likewise withheld from the pending
 * text until they resolve.
 */

import { decodeEntities, decodeEntity, MAX_ENTITY_LENGTH } from "./entities";

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

export type AttrValue =
  | { type: "string"; value: string }
  /** Boolean shorthand: `disabled` desugars to `disabled={true}`. */
  | { type: "boolean" }
  /** `attr={...}`; `raw` is the inner source, `loc` the `{`. */
  | { type: "expression"; raw: string; loc: SourceLocation };

export type Token =
  /** `name` is `""` for a fragment (`<>`). `loc` is the `<`. */
  | { type: "openTagStart"; name: string; loc: SourceLocation }
  | { type: "attribute"; name: string; value: AttrValue }
  /** `>` terminating an opening tag. `loc` is the `>`. */
  | { type: "openTagEnd"; loc: SourceLocation }
  /** `/>` terminating a self-closing element. `loc` is the `>`. */
  | { type: "selfClose"; loc: SourceLocation }
  /** `name` is `""` for a fragment close (`</>`). `loc` is the `<`. */
  | { type: "closeTag"; name: string; loc: SourceLocation }
  | { type: "text"; value: string }
  /** A child expression container; `raw` is the inner source, `loc` the `{`. */
  | { type: "expr"; raw: string; loc: SourceLocation };

/** The half-read construct at the cursor; see PLAN.md §1. */
export type Pending =
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
 * Whether `ch` can extend a buffered character reference: `#` right after the
 * `&`, then alphanumerics (which covers the `x` of hex references).
 */
function isEntityBodyChar(ch: string, buf: string): boolean {
  if (ch === "#") return buf === "&";
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
}

/**
 * The recorded start of a construct (`<` of a tag, `{` of an expression).
 * `lineText` stays `null` while the anchor's line is still streaming and is
 * snapshotted when the line ends, so a construct spanning lines still reports
 * its *starting* line.
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
  /** Child text so far: entity-decoded and whitespace-normalized. */
  private text = "";
  /**
   * Whitespace seen since the last text character, not yet committed: kept if
   * more text follows on the same line, dropped if a line break follows.
   */
  private textWs = "";
  /**
   * A line break has been seen since the last text character: further
   * whitespace is indentation (dropped) and the next text character joins
   * with a single space.
   */
  private textNewline = false;
  /** A possible character reference being buffered, starting with its `&`. */
  private entityBuf = "";
  /** Tag name (open or close). */
  private name = "";
  private attrName = "";
  private attrValue = "";
  private quote = "";
  /** Re-process the current character in the new state. */
  private reconsume = false;

  // Position of the character currently being processed.
  private line = 1;
  private column = 1;
  private offset = 0;
  /** Content of the current line so far (capped at {@link MAX_LINE_TEXT}). */
  private lineText = "";
  private tagAnchor: Anchor | null = null;
  private exprAnchor: Anchor | null = null;

  // Expression container (`{ ... }`) scanning state.
  /** Raw source between the outer braces. */
  private exprRaw = "";
  /** Brace nesting depth; 0 means the matching `}` has been found. */
  private exprDepth = 0;
  /** The quote currently open inside the expression (empty if none). */
  private exprQuote = "";
  private exprEscape = false;
  /** The expression is the value of {@link attrName} (vs a child). */
  private exprIsAttr = false;

  /** Feed a string chunk; returns the tokens completed by this chunk. */
  write(chunk: string): Token[] {
    const out: Token[] = [];
    for (const ch of chunk) {
      // Append before processing, so a token emitted on a delimiter (`>`, `}`)
      // captures a `lineText` that contains the whole construct.
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

  /**
   * Signal end of input. Flushes any trailing text run; an incomplete tag or
   * attribute is discarded (it never became renderable).
   */
  end(): Token[] {
    const out: Token[] = [];
    if (this.state === State.Text) this.flushText(out);
    return out;
  }

  /** The half-read construct at the cursor (PLAN.md §1). */
  getPending(): Pending {
    if (this.state === State.Text && this.text.length > 0) {
      return { type: "text", value: this.text };
    }
    return { type: "none" };
  }

  /** Snapshot the completed line into any anchor still waiting for it. */
  private finishLine(): void {
    for (const anchor of [this.tagAnchor, this.exprAnchor]) {
      if (anchor && anchor.lineText === null) anchor.lineText = this.lineText;
    }
    this.lineText = "";
  }

  private anchorHere(): Anchor {
    return { line: this.line, column: this.column, offset: this.offset, lineText: null };
  }

  /** The location of `anchor`, or of the cursor when there is none. */
  private location(anchor: Anchor | null = null): SourceLocation {
    const { line, column, offset, lineText } = anchor ?? this.anchorHere();
    return { line, column, offset, lineText: lineText ?? this.lineText };
  }

  private takeTagLoc(): SourceLocation {
    const loc = this.location(this.tagAnchor);
    this.tagAnchor = null;
    return loc;
  }

  private emitAttribute(out: Token[], value: AttrValue): void {
    out.push({ type: "attribute", name: this.attrName, value });
    this.attrName = "";
  }

  private emitCloseTag(out: Token[]): void {
    out.push({ type: "closeTag", name: this.name, loc: this.takeTagLoc() });
    this.name = "";
    this.state = State.Text;
  }

  private step(ch: string, out: Token[]): void {
    switch (this.state) {
      case State.Text: {
        if (this.entityBuf !== "") {
          if (ch === ";") {
            this.resolveEntity();
            return;
          }
          if (this.entityBuf.length < MAX_ENTITY_LENGTH && isEntityBodyChar(ch, this.entityBuf)) {
            this.entityBuf += ch;
            return;
          }
          // Not a reference after all: keep it verbatim, then handle `ch`.
          this.flushEntityLiteral();
        }
        if (ch === "<") {
          this.flushText(out);
          this.tagAnchor = this.anchorHere();
          this.state = State.TagOpen;
        } else if (ch === "{") {
          this.flushText(out);
          this.startExpression(false);
        } else if (ch === "&") {
          this.entityBuf = "&";
        } else {
          this.appendText(ch);
        }
        return;
      }

      case State.TagOpen: {
        if (ch === "/") {
          this.name = "";
          this.state = State.CloseTagName;
        } else if (ch === ">") {
          out.push({ type: "openTagStart", name: "", loc: this.takeTagLoc() });
          out.push({ type: "openTagEnd", loc: this.location() });
          this.state = State.Text;
        } else if (isNameStart(ch)) {
          this.name = ch;
          this.state = State.TagName;
        }
        // Anything else is leniently ignored (here and in the states below).
        return;
      }

      case State.TagName: {
        if (isNameChar(ch)) {
          this.name += ch;
        } else {
          out.push({ type: "openTagStart", name: this.name, loc: this.takeTagLoc() });
          this.name = "";
          this.state = State.BeforeAttrName;
          this.reconsume = true;
        }
        return;
      }

      case State.BeforeAttrName: {
        if (ch === ">") {
          out.push({ type: "openTagEnd", loc: this.location() });
          this.state = State.Text;
        } else if (ch === "/") {
          this.state = State.SelfClose;
        } else if (isNameStart(ch)) {
          this.attrName = ch;
          this.state = State.AttrName;
        }
        return;
      }

      case State.AttrName: {
        if (isNameChar(ch)) {
          this.attrName += ch;
        } else if (ch === "=") {
          this.state = State.BeforeAttrValue;
        } else if (isWhitespace(ch)) {
          this.state = State.AfterAttrName;
        } else {
          this.emitAttribute(out, { type: "boolean" });
          this.state = State.BeforeAttrName;
          this.reconsume = true;
        }
        return;
      }

      case State.AfterAttrName: {
        if (ch === "=") {
          this.state = State.BeforeAttrValue;
        } else if (!isWhitespace(ch)) {
          // A new attribute, `>` or `/`: the previous bare name was boolean.
          this.emitAttribute(out, { type: "boolean" });
          this.state = State.BeforeAttrName;
          this.reconsume = true;
        }
        return;
      }

      case State.BeforeAttrValue: {
        if (ch === '"' || ch === "'") {
          this.quote = ch;
          this.attrValue = "";
          this.state = State.AttrValueString;
        } else if (ch === "{") {
          this.startExpression(true);
        }
        // Unquoted values are out of scope.
        return;
      }

      case State.AttrValueString: {
        if (ch === this.quote) {
          this.emitAttribute(out, { type: "string", value: decodeEntities(this.attrValue) });
          this.state = State.BeforeAttrName;
        } else {
          this.attrValue += ch;
        }
        return;
      }

      case State.SelfClose: {
        if (ch === ">") {
          out.push({ type: "selfClose", loc: this.location() });
          this.state = State.Text;
        }
        return;
      }

      case State.CloseTagName: {
        if (isNameChar(ch)) {
          this.name += ch;
        } else if (ch === ">") {
          this.emitCloseTag(out);
        } else if (isWhitespace(ch)) {
          this.state = State.CloseTagEnd;
        }
        return;
      }

      case State.CloseTagEnd: {
        if (ch === ">") this.emitCloseTag(out);
        return;
      }

      case State.Expression: {
        // Inside a string/template literal, braces and other quotes do not
        // affect nesting.
        if (this.exprQuote) {
          if (this.exprEscape) this.exprEscape = false;
          else if (ch === "\\") this.exprEscape = true;
          else if (ch === this.exprQuote) this.exprQuote = "";
        } else if (ch === '"' || ch === "'" || ch === "`") {
          this.exprQuote = ch;
        } else if (ch === "{") {
          this.exprDepth++;
        } else if (ch === "}" && --this.exprDepth === 0) {
          this.finishExpression(out);
          return;
        }
        this.exprRaw += ch;
        return;
      }
    }
  }

  /**
   * Append one already-decoded character to the text run, applying the JSX
   * whitespace rules incrementally (see the module doc).
   */
  private appendText(ch: string): void {
    if (ch === "\n" || ch === "\r") {
      // Whitespace before a line break is line-trailing: dropped.
      this.textWs = "";
      this.textNewline = true;
      return;
    }
    if (ch === " " || ch === "\t") {
      if (!this.textNewline) this.textWs += " ";
      return;
    }
    if (this.textNewline) {
      if (this.text.length > 0) this.text += " ";
      this.textNewline = false;
    } else {
      this.text += this.textWs;
    }
    this.textWs = "";
    this.text += ch;
  }

  private appendDecoded(value: string): void {
    for (const ch of value) this.appendText(ch);
  }

  private flushEntityLiteral(): void {
    this.appendDecoded(this.entityBuf);
    this.entityBuf = "";
  }

  /** A `;` arrived: decode the buffered reference, or keep it verbatim. */
  private resolveEntity(): void {
    const decoded = decodeEntity(this.entityBuf.slice(1));
    this.appendDecoded(decoded ?? this.entityBuf + ";");
    this.entityBuf = "";
  }

  private flushText(out: Token[]): void {
    if (this.entityBuf !== "") this.flushEntityLiteral();
    // Whitespace at the end of the run's last line is kept; anything parked
    // after a line break is dropped.
    if (!this.textNewline) this.text += this.textWs;
    this.textWs = "";
    this.textNewline = false;
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
    this.state = State.Expression;
  }

  private finishExpression(out: Token[]): void {
    const loc = this.location(this.exprAnchor);
    this.exprAnchor = null;
    if (this.exprIsAttr) {
      this.emitAttribute(out, { type: "expression", raw: this.exprRaw, loc });
      this.state = State.BeforeAttrName;
    } else {
      out.push({ type: "expr", raw: this.exprRaw, loc });
      this.state = State.Text;
    }
    this.exprRaw = "";
  }
}
