/**
 * Expression value parsing (PLAN.md §2).
 *
 * Parses the raw source captured between `{ }` into a concrete value. The
 * supported subset is deliberately tiny: string/template (no substitutions)
 * literals, number literals, `true`/`false`/`null`/`undefined`, a variable
 * reference (`foo`, or dot-notation member access `foo.bar.baz`), and a nested
 * JSX element/fragment. Anything else yields {@link UNSUPPORTED_EXPRESSION}.
 *
 * Nested JSX and variable references are handled by injected callbacks
 * (`parseJsx` / `parseVariable`), so this module does not depend on the tree
 * builder.
 */

import { FORBIDDEN_SEGMENTS, UNSUPPORTED_EXPRESSION } from "./ast";
import type { Node, PropValue } from "./ast";

export type ParsedExpression = PropValue | typeof UNSUPPORTED_EXPRESSION;

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function parseExpression(
  raw: string,
  parseJsx: (src: string) => Node | undefined,
  parseVariable?: (path: readonly string[]) => Node | undefined,
): ParsedExpression {
  const t = raw.trim();
  if (t === "") return undefined;

  const first = t[0]!;
  if (first === "<") {
    return parseJsx(t) ?? UNSUPPORTED_EXPRESSION;
  }
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (t === "undefined") return undefined;
  if (first === "'" || first === '"' || first === "`") {
    return parseQuotedLiteral(t) ?? UNSUPPORTED_EXPRESSION;
  }
  if (NUMBER_RE.test(t)) {
    const n = Number(t);
    if (!Number.isNaN(n)) return n;
  }
  const path = parseVariablePath(t);
  return (path && parseVariable?.(path)) ?? UNSUPPORTED_EXPRESSION;
}

/**
 * Parse a variable reference — a bare identifier (`foo`) or a dot-notation
 * member chain (`foo.bar.baz`, whitespace around dots allowed); undefined if
 * `t` is not exactly one. Bracket access, calls, and the
 * {@link FORBIDDEN_SEGMENTS} are out of scope.
 */
function parseVariablePath(t: string): string[] | undefined {
  const parts = t.split(".").map((part) => part.trim());
  return parts.every((part) => IDENTIFIER_RE.test(part) && !FORBIDDEN_SEGMENTS.has(part))
    ? parts
    : undefined;
}

function unescape(ch: string | undefined): string {
  switch (ch) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "v":
      return "\v";
    case "0":
      return "\0";
    case undefined:
      return "";
    default:
      return ch;
  }
}

/**
 * Parse a single string literal, or a template literal without substitutions;
 * undefined if `t` is not exactly one.
 */
function parseQuotedLiteral(t: string): string | undefined {
  const quote = t[0]!;
  let out = "";
  for (let i = 1; i < t.length; i++) {
    const ch = t[i]!;
    if (ch === "\\") {
      out += unescape(t[i + 1]);
      i++;
      continue;
    }
    if (ch === quote) {
      return i === t.length - 1 ? out : undefined;
    }
    if (quote === "`" && ch === "$" && t[i + 1] === "{") {
      return undefined;
    }
    out += ch;
  }
  return undefined;
}
