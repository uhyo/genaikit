/**
 * Built-in Markdown renderer: a small, dependency-free CommonMark subset
 * rendered straight to React elements.
 *
 * Supported blocks: ATX headings (`#`–`######`), paragraphs (with hard breaks
 * via trailing double-space or backslash), unordered/ordered lists (nested by
 * indentation; tight lists only), blockquotes, fenced code blocks (backticks),
 * and thematic breaks. Inline: `**strong**`/`__strong__`, `*em*`/`_em_`,
 * `` `code` ``, links `[text](url)`, images `![alt](src)`, and backslash
 * escapes.
 *
 * Deliberately **not** supported (v1): raw HTML (it renders as literal text —
 * React escapes it, so AI output cannot inject markup), setext headings,
 * tables, loose lists, lazy blockquote continuation, reference links, and
 * `~~~` fences.
 *
 * Link/image URLs are sanitized: links allow `http:` / `https:` / `mailto:`
 * and scheme-less URLs; images allow `http:` / `https:` and scheme-less.
 * Anything else (e.g. `javascript:`) renders as plain text.
 *
 * The renderer is pure and total — called repeatedly on a *growing* prefix of
 * the document while it streams, so it must render any truncated input
 * reasonably (an unterminated fence is a code block to the end, an
 * unterminated emphasis renders literally, …).
 */

import type { ReactNode } from "react";

const FENCE_OPEN = /^ {0,3}(`{3,})([^`]*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,})[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const BLOCKQUOTE_LINE = /^ {0,3}> ?(.*)$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const BLANK = /^[ \t]*$/;

/** True when a URL is acceptable for a link (`href`). */
function isSafeLinkUrl(url: string): boolean {
  return hasAllowedScheme(url, ["http", "https", "mailto"]);
}

/** True when a URL is acceptable for an image (`src`). */
function isSafeImageUrl(url: string): boolean {
  return hasAllowedScheme(url, ["http", "https"]);
}

function hasAllowedScheme(url: string, allowed: readonly string[]): boolean {
  // Sniff the scheme with control characters and spaces stripped, so
  // "java\nscript:" or a leading tab cannot smuggle one past the check.
  let cleaned = "";
  for (const ch of url) {
    if (ch.charCodeAt(0) > 0x20) cleaned += ch;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(cleaned.toLowerCase());
  if (!scheme) return true; // relative URL / fragment / query
  return allowed.includes(scheme[1]!);
}

/** Mutable key counter shared across one render pass. */
interface Keys {
  next: number;
}

function isPunctuation(ch: string): boolean {
  return /[!-/:-@[-`{-~]/.test(ch);
}

/** Find a closing delimiter run equal to `delim` at or after `from`. */
function findClose(text: string, delim: string, from: number): number {
  for (let i = from; i <= text.length - delim.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text.startsWith(delim, i)) return i;
  }
  return -1;
}

/** Render inline Markdown into React nodes. */
function renderInline(text: string, keys: Keys): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = "";
  const flush = (): void => {
    if (plain !== "") {
      out.push(plain);
      plain = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;

    if (ch === "\\" && i + 1 < text.length && isPunctuation(text[i + 1]!)) {
      plain += text[i + 1]!;
      i += 2;
      continue;
    }

    if (ch === "`") {
      let runEnd = i;
      while (runEnd < text.length && text[runEnd] === "`") runEnd++;
      const run = text.slice(i, runEnd);
      // A code span's closer is an equal-length backtick run (no escapes).
      let close = -1;
      for (let j = runEnd; j <= text.length - run.length; j++) {
        if (text.startsWith(run, j) && text[j + run.length] !== "`") {
          close = j;
          break;
        }
        if (text[j] === "`") while (j < text.length - 1 && text[j + 1] === "`") j++;
      }
      if (close !== -1) {
        let content = text.slice(runEnd, close);
        // CommonMark: strip one space from both ends when both are spaces
        // (and the content is not all spaces).
        if (
          content.length >= 2 &&
          content.startsWith(" ") &&
          content.endsWith(" ") &&
          content.trim() !== ""
        ) {
          content = content.slice(1, -1);
        }
        flush();
        out.push(<code key={keys.next++}>{content}</code>);
        i = close + run.length;
        continue;
      }
      plain += run;
      i = runEnd;
      continue;
    }

    if (ch === "*" || ch === "_") {
      const double = text[i + 1] === ch;
      const delim = double ? ch + ch : ch;
      let close = findClose(text, delim, i + delim.length);
      if (close !== -1) {
        // Close at the END of the delimiter run, so `**bold *inner***`
        // nests instead of closing early.
        let runEnd = close;
        while (runEnd < text.length && text[runEnd] === ch) runEnd++;
        close = Math.max(close, runEnd - delim.length);
        const inner = text.slice(i + delim.length, close);
        if (inner.trim() !== "") {
          flush();
          const children = renderInline(inner, keys);
          out.push(
            double ? (
              <strong key={keys.next++}>{children}</strong>
            ) : (
              <em key={keys.next++}>{children}</em>
            ),
          );
          i = close + delim.length;
          continue;
        }
      }
      plain += ch;
      i++;
      continue;
    }

    const image = ch === "!" && text[i + 1] === "[";
    if (ch === "[" || image) {
      const open = image ? i + 1 : i;
      const closeBracket = findClose(text, "]", open + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        // The destination ends at the matching (balanced) closing paren.
        let closeParen = -1;
        let depth = 1;
        for (let j = closeBracket + 2; j < text.length; j++) {
          const c = text[j];
          if (c === "\\") j++;
          else if (c === "(") depth++;
          else if (c === ")" && --depth === 0) {
            closeParen = j;
            break;
          }
        }
        if (closeParen !== -1) {
          const label = text.slice(open + 1, closeBracket);
          const dest = text.slice(closeBracket + 2, closeParen).trim();
          flush();
          if (image) {
            if (isSafeImageUrl(dest)) {
              out.push(<img key={keys.next++} src={dest} alt={label} />);
            } else {
              plain += label;
            }
          } else if (isSafeLinkUrl(dest)) {
            out.push(
              <a key={keys.next++} href={dest}>
                {renderInline(label, keys)}
              </a>,
            );
          } else {
            out.push(...renderInline(label, keys));
          }
          i = closeParen + 1;
          continue;
        }
      }
      plain += ch;
      i++;
      continue;
    }

    plain += ch;
    i++;
  }
  flush();
  return out;
}

/** Render a paragraph's lines, turning hard breaks into `<br />`. */
function renderParagraphContent(lines: readonly string[], keys: Keys): ReactNode[] {
  const out: ReactNode[] = [];
  lines.forEach((raw, index) => {
    let line = raw.trim();
    let hard = false;
    if (index < lines.length - 1) {
      if (/ {2,}$/.test(raw)) hard = true;
      else if (line.endsWith("\\")) {
        hard = true;
        line = line.slice(0, -1);
      }
    }
    out.push(...renderInline(line, keys));
    if (index < lines.length - 1) {
      if (hard) out.push(<br key={keys.next++} />);
      else out.push(" ");
    }
  });
  return out;
}

interface ListParse {
  node: ReactNode;
  next: number;
}

/** Parse the list starting at `lines[start]` (which matches LIST_ITEM). */
function parseList(lines: readonly string[], start: number, keys: Keys): ListParse {
  const first = LIST_ITEM.exec(lines[start]!)!;
  const baseIndent = first[1]!.length;
  const ordered = /^\d/.test(first[2]!);

  const items: ReactNode[] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i]!);
    if (!m || m[1]!.length !== baseIndent || /^\d/.test(m[2]!) !== ordered) break;
    const contentIndent = baseIndent + m[2]!.length + 1;
    const texts: string[] = m[3] === undefined ? [] : [m[3]];
    const nested: ReactNode[] = [];
    i++;
    while (i < lines.length) {
      const line = lines[i]!;
      if (BLANK.test(line)) break;
      const indent = /^ */.exec(line)![0].length;
      if (indent <= baseIndent) break;
      const sub = LIST_ITEM.exec(line);
      if (sub && sub[1]!.length > baseIndent) {
        const child = parseList(lines, i, keys);
        nested.push(child.node);
        i = child.next;
        continue;
      }
      texts.push(line.slice(Math.min(contentIndent, indent)));
      i++;
    }
    items.push(
      <li key={keys.next++}>
        {renderParagraphContent(texts, keys)}
        {nested}
      </li>,
    );
  }

  const node = ordered ? <ol key={keys.next++}>{items}</ol> : <ul key={keys.next++}>{items}</ul>;
  return { node, next: i };
}

function parseBlocks(lines: readonly string[], keys: Keys): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (BLANK.test(line)) {
      i++;
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const size = fence[1]!.length;
      const lang = fence[2]!.trim().split(/\s+/)[0] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = FENCE_CLOSE.exec(lines[i]!);
        if (close && close[1]!.length >= size) {
          i++;
          break;
        }
        body.push(lines[i]!);
        i++;
      }
      const content = body.length === 0 ? "" : body.join("\n") + "\n";
      out.push(
        <pre key={keys.next++}>
          <code {...(lang === "" ? {} : { className: `language-${lang}` })}>{content}</code>
        </pre>,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const content = (heading[2] ?? "").replace(/[ \t]+#+$/, "");
      const Tag = `h${level}` as "h1";
      out.push(<Tag key={keys.next++}>{renderInline(content, keys)}</Tag>);
      i++;
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      out.push(<hr key={keys.next++} />);
      i++;
      continue;
    }

    if (BLOCKQUOTE_LINE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const m = BLOCKQUOTE_LINE.exec(lines[i]!);
        if (!m) break;
        inner.push(m[1]!);
        i++;
      }
      out.push(<blockquote key={keys.next++}>{parseBlocks(inner, keys)}</blockquote>);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const list = parseList(lines, i, keys);
      out.push(list.node);
      i = list.next;
      continue;
    }

    // Paragraph: gather until a blank line or the start of another block.
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i]!;
      if (
        BLANK.test(next) ||
        FENCE_OPEN.test(next) ||
        HEADING.test(next) ||
        THEMATIC_BREAK.test(next) ||
        BLOCKQUOTE_LINE.test(next) ||
        LIST_ITEM.test(next)
      ) {
        break;
      }
      para.push(next);
      i++;
    }
    out.push(<p key={keys.next++}>{renderParagraphContent(para, keys)}</p>);
  }
  return out;
}

/**
 * Render a Markdown string to React nodes (see the module doc for the exact
 * subset). Safe on untrusted input: raw HTML is rendered as literal text and
 * link/image URLs are scheme-checked.
 */
export function renderMarkdown(source: string): ReactNode {
  if (source === "") return null;
  return parseBlocks(source.split("\n"), { next: 0 });
}
