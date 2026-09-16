/**
 * Schema: element allowlisting, host prop validation, and the prompt contract.
 *
 * The `components` / `variables` maps already act as allowlists for
 * component tags and `{ }` references; this module extends the same idea to
 * intrinsic (lowercase) HTML elements and their props, so untrusted
 * AI-generated JSX can be constrained to a declared schema. Following the
 * `resolveVariablePath` precedent, the checks live here as shared, canonical
 * helpers: the parse-time events (`"disallowed-element"` / `"invalid-prop"`)
 * and the render-time enforcement both call them, so the two always agree.
 *
 * Because the schema is plain data, it doubles as the **prompt contract**:
 * {@link formatPromptContract} serializes the configured subset into text
 * ready to paste into the system prompt of the model producing the stream.
 *
 * Zero React dependency — exported through both the root and `/core` entries.
 */

import { resolveVariablePath, UNSUPPORTED_EXPRESSION } from "./core";
import type { PropValue, VariableNode } from "./core";
import { isComponentName } from "./tree-builder";

/**
 * Allowlist of intrinsic (lowercase) HTML elements. Either a list of tag
 * names (any prop allowed on them, minus the built-in rules), or a record
 * mapping each allowed tag to `true` (any prop) or to its allowed prop names.
 *
 * ```ts
 * elements: ["div", "span", "p"]
 * elements: { div: true, a: ["href", "title"] }
 * ```
 *
 * Component-like tags (Capitalized / dotted) are never governed by this list —
 * they resolve through `components`, which is its own allowlist.
 */
export type ElementAllowlist =
  | readonly string[]
  | Readonly<Record<string, true | readonly string[]>>;

/** The schema inputs shared by the parse-time and render-time checks. */
export interface SchemaOptions {
  /** Intrinsic-element allowlist; absent = every intrinsic tag is allowed. */
  elements?: ElementAllowlist | undefined;
  /** Predefined variables, used to validate variable-valued props (`style`). */
  variables?: Record<string, unknown> | undefined;
}

/** The per-tag entry for `tag`, or `undefined` when the tag is not allowed. */
function elementEntry(
  elements: ElementAllowlist,
  tag: string,
): true | readonly string[] | undefined {
  if (Array.isArray(elements)) {
    return (elements as readonly string[]).includes(tag) ? true : undefined;
  }
  const record = elements as Readonly<Record<string, true | readonly string[]>>;
  return Object.hasOwn(record, tag) ? record[tag] : undefined;
}

/**
 * Whether `tag` passes the element allowlist. Component-like tags always pass
 * (they are governed by `components` instead), as does everything when no
 * allowlist is configured.
 */
export function isElementAllowed(elements: ElementAllowlist | undefined, tag: string): boolean {
  if (elements === undefined || isComponentName(tag)) return true;
  return elementEntry(elements, tag) !== undefined;
}

/**
 * Props that are never allowed on an intrinsic element, whatever the schema:
 * HTML injection vectors (`dangerouslySetInnerHTML`, `srcDoc`), React
 * internals (`ref`, `key` — the parser assigns its own stable keys), and
 * `children` as a prop (children come from the JSX body). Compared
 * case-insensitively, since React passes unknown lowercase attributes
 * through to the DOM.
 */
const BLOCKED_HOST_PROPS: ReadonlySet<string> = new Set([
  "dangerouslysetinnerhtml",
  "srcdoc",
  "ref",
  "key",
  "children",
]);

/** Props whose string values are URLs and must not carry an unsafe scheme. */
const URL_PROPS: ReadonlySet<string> = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "xlinkhref",
  "poster",
  "data",
  "cite",
]);

/** `javascript:` and friends, with control/space characters stripped first. */
function isUnsafeUrl(url: string): boolean {
  // Stripping control characters is the point here (they hide the scheme).
  // oxlint-disable-next-line no-control-regex
  const cleaned = url.replace(/[\u0000-\u0020]/g, "").toLowerCase();
  return (
    cleaned.startsWith("javascript:") ||
    cleaned.startsWith("vbscript:") ||
    cleaned.startsWith("data:text/html")
  );
}

function isVariableNode(value: unknown): value is VariableNode {
  return (
    value !== null && typeof value === "object" && (value as { kind?: unknown }).kind === "variable"
  );
}

/**
 * Validate a prop on an intrinsic element against the schema. Returns `null`
 * when the prop is fine, or a human-readable **reason** when it must be
 * rejected — the same helper backs the parse-time `"invalid-prop"` event and
 * the render-time drop, so reporting and enforcement never disagree.
 *
 * Beyond any per-tag allowlist in {@link SchemaOptions.elements}, these
 * built-in rules always apply to intrinsic elements (they are what makes the
 * "lenient by design" promise hold — React would otherwise throw on them):
 *
 *  - the {@link BLOCKED_HOST_PROPS} are always rejected;
 *  - `on*` event handler props must reference a predefined variable
 *    (`onClick={actions.confirm}`) — functions are not expressible in the
 *    JSX subset, and string handlers would be unsafe;
 *  - `style` must be a predefined variable resolving to an object — React
 *    rejects string styles at render time;
 *  - URL-valued props (`href`, `src`, …) must not use `javascript:` &c.
 *
 * Component tags are exempt: their props are the component author's contract.
 * An `UNSUPPORTED_EXPRESSION` value is exempt too — it was already reported
 * and renders as nothing.
 */
export function checkHostProp(
  tag: string,
  prop: string,
  value: PropValue,
  options: SchemaOptions = {},
): string | null {
  if (isComponentName(tag)) return null;
  if ((value as unknown) === UNSUPPORTED_EXPRESSION) return null;

  if (options.elements) {
    const entry = elementEntry(options.elements, tag);
    if (Array.isArray(entry) && !(entry as readonly string[]).includes(prop)) {
      return `not an allowed prop for <${tag}> (allowed: ${entry.join(", ")})`;
    }
  }

  const lower = prop.toLowerCase();
  if (BLOCKED_HOST_PROPS.has(lower)) {
    return "this prop is never allowed on an HTML element";
  }
  if (lower.startsWith("on") && prop.length > 2) {
    return isVariableNode(value)
      ? null
      : "an event handler must reference a predefined variable (e.g. onClick={actions.confirm})";
  }
  if (lower === "style") {
    if (value == null) return null;
    if (isVariableNode(value)) {
      if (options.variables === undefined) return null;
      const resolved = resolveVariablePath(options.variables, value.path);
      // Unresolvable is already reported as "unknown-variable" and renders as
      // `undefined`; a resolved value must be an object (or nullish).
      if (!resolved.found || resolved.value == null) return null;
      return typeof resolved.value === "object"
        ? null
        : "style must resolve to an object, not a string";
    }
    return "style must be a predefined variable holding an object, not a string";
  }
  if (URL_PROPS.has(lower) && typeof value === "string" && isUnsafeUrl(value)) {
    return `unsafe URL scheme in "${prop}"`;
  }
  return null;
}

/** Options for {@link formatPromptContract} — the same maps the parser takes. */
export interface PromptContractOptions {
  /** Component allowlist; only the tag names are read. */
  components?: Record<string, unknown> | undefined;
  /** Predefined variables; described by name and shallow shape, not value. */
  variables?: Record<string, unknown> | undefined;
  /** Intrinsic-element allowlist. */
  elements?: ElementAllowlist | undefined;
}

/** One-line shape summary of a variable value (no values are leaked). */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  if (type !== "object") return type;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return "object";
  const fields = keys
    .slice(0, 8)
    .map((key) => `${key} (${summarize((value as Record<string, unknown>)[key])})`)
    .join(", ");
  return `object with fields: ${fields}${keys.length > 8 ? ", …" : ""}`;
}

function summarize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Serialize the configured schema into a **prompt contract**: a plain-text
 * spec of the JSX subset, the allowed elements/props, the available
 * components, and the predefined variables — ready to paste into the system
 * prompt of the model generating the stream. Pair it with `onJsxError` +
 * `formatJsxError` for the feedback direction, and the loop is closed: the
 * contract tells the model what it may emit, the events tell it what it got
 * wrong.
 *
 * Variable values are described by name and shallow shape only; the values
 * themselves are never included.
 */
export function formatPromptContract(options: PromptContractOptions = {}): string {
  const lines: string[] = [
    "Generate the UI as JSX, using only the subset described below.",
    "Output raw JSX only — no prose, no markdown code fences, no imports, no statements.",
    "",
    "## Syntax",
    "- Elements, fragments (<>…</>), and self-closing tags (<br />).",
    '- Attributes: string values (attr="…"), boolean shorthand (disabled), or an expression (attr={…}).',
    "- An expression in { } (attribute value or child) may only be: a string or number literal,",
    "  true / false / null / undefined, a template literal without ${}, a reference to a predefined",
    "  variable listed below (dot access allowed, e.g. {user.name}), or nested JSX.",
    "- Nothing else is evaluated: no function calls, arithmetic, conditionals, comments ({/* … */}),",
    "  or spread props.",
    '- Text is rendered literally: do not use HTML entities (write & and " directly); to show a',
    '  literal < or { in text, use a string expression like {"<"}.',
    "- Never write inline functions. To attach behavior, pass a predefined variable:",
    "  onClick={actions.confirm}.",
    "",
    "## HTML elements",
  ];

  const elements = options.elements;
  if (elements === undefined) {
    lines.push("- Any standard lowercase HTML element is allowed.");
  } else if (Array.isArray(elements)) {
    for (const tag of elements as readonly string[]) lines.push(`- <${tag}>`);
    lines.push("- Never use an element outside this list.");
  } else {
    const record = elements as Readonly<Record<string, true | readonly string[]>>;
    for (const [tag, entry] of Object.entries(record)) {
      lines.push(entry === true ? `- <${tag}>` : `- <${tag}> — allowed props: ${entry.join(", ")}`);
    }
    lines.push("- Never use an element or a prop outside this list.");
  }
  lines.push(
    "- Never use these props on an HTML element: dangerouslySetInnerHTML, srcDoc, ref, key, children.",
    "- style must be a predefined variable holding an object — never a string.",
    "- URL props (href, src, action, …) must not use the javascript: scheme.",
    "",
    "## Components",
  );

  const componentNames = Object.keys(options.components ?? {});
  if (componentNames.length === 0) {
    lines.push("- No components are available; use HTML elements only.");
  } else {
    for (const name of componentNames) lines.push(`- <${name}>`);
    lines.push("- These are the only components that exist.");
  }
  lines.push("", "## Predefined variables");

  const variables = options.variables;
  const variableNames = Object.keys(variables ?? {});
  if (variableNames.length === 0) {
    lines.push("- No variables are defined; do not use {name} references.");
  } else {
    for (const name of variableNames) {
      lines.push(`- {${name}} — ${describeValue((variables as Record<string, unknown>)[name])}`);
    }
    lines.push("- These are the only variables that exist.");
  }

  return lines.join("\n");
}
