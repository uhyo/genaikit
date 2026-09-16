import { fireEvent, render } from "@testing-library/react";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  checkHostProp,
  createParser,
  formatPromptContract,
  isElementAllowed,
  UNSUPPORTED_EXPRESSION,
} from "./core";
import type { JsxErrorEvent, PropValue, VariableNode } from "./core";
import { createIncrementalJsxParser } from "./index";
import { createRenderer, type RenderOptions } from "./render";

/** Parse a complete input and render it to static HTML. */
function toHtml(input: string, options?: RenderOptions): string {
  const core = createParser();
  core.write(input);
  core.end();
  const renderer = createRenderer(options);
  return renderToStaticMarkup(createElement(Fragment, null, renderer.render(core.getTree())));
}

function variable(...path: string[]): VariableNode {
  return { kind: "variable", id: 1, path };
}

describe("isElementAllowed", () => {
  it("allows everything when no allowlist is configured", () => {
    expect(isElementAllowed(undefined, "script")).toBe(true);
  });

  it("checks membership for the list form", () => {
    expect(isElementAllowed(["div", "span"], "div")).toBe(true);
    expect(isElementAllowed(["div", "span"], "script")).toBe(false);
  });

  it("checks keys for the record form", () => {
    expect(isElementAllowed({ div: true, a: ["href"] }, "a")).toBe(true);
    expect(isElementAllowed({ div: true }, "iframe")).toBe(false);
  });

  it("never governs component-like tags (that is what `components` is for)", () => {
    expect(isElementAllowed(["div"], "Card")).toBe(true);
    expect(isElementAllowed(["div"], "Icons.Star")).toBe(true);
  });

  it("does not treat inherited object members as allowlisted tags", () => {
    expect(isElementAllowed({ div: true }, "toString")).toBe(false);
  });
});

describe("checkHostProp — built-in rules", () => {
  it("exempts component tags and the unsupported-expression sentinel", () => {
    expect(checkHostProp("Card", "style", "red")).toBeNull();
    expect(
      checkHostProp("div", "style", UNSUPPORTED_EXPRESSION as unknown as PropValue),
    ).toBeNull();
  });

  it("always rejects the HTML-injection and React-internal props", () => {
    for (const prop of ["dangerouslySetInnerHTML", "srcDoc", "srcdoc", "ref", "key", "children"]) {
      expect(checkHostProp("div", prop, "x"), prop).not.toBeNull();
    }
  });

  it("rejects string styles but accepts a variable resolving to an object", () => {
    const options = { variables: { theme: { card: { color: "red" }, oops: "red" } } };
    expect(checkHostProp("div", "style", "color:red", options)).not.toBeNull();
    expect(checkHostProp("div", "style", variable("theme", "card"), options)).toBeNull();
    expect(checkHostProp("div", "style", variable("theme", "oops"), options)).not.toBeNull();
    // Unresolvable → renders as undefined; already reported as unknown-variable.
    expect(checkHostProp("div", "style", variable("nope"), options)).toBeNull();
  });

  it("rejects on* handlers unless they reference a predefined variable", () => {
    expect(checkHostProp("button", "onClick", "alert(1)")).not.toBeNull();
    expect(checkHostProp("button", "onclick", "alert(1)")).not.toBeNull();
    expect(checkHostProp("button", "onClick", variable("actions", "go"))).toBeNull();
  });

  it("rejects unsafe URL schemes, including obfuscated ones", () => {
    expect(checkHostProp("a", "href", "javascript:alert(1)")).not.toBeNull();
    expect(checkHostProp("a", "href", " JaVaScRiPt:alert(1)")).not.toBeNull();
    expect(checkHostProp("a", "href", "java\u0000script:alert(1)")).not.toBeNull();
    expect(checkHostProp("iframe", "src", "data:text/html,<script>")).not.toBeNull();
    expect(checkHostProp("a", "href", "https://example.com/")).toBeNull();
    expect(checkHostProp("a", "href", "/relative?q=javascript:")).toBeNull();
  });

  it("enforces a per-tag prop allowlist from the record form", () => {
    const options = { elements: { a: ["href"] } } as const;
    expect(checkHostProp("a", "href", "/x", options)).toBeNull();
    expect(checkHostProp("a", "id", "z", options)).not.toBeNull();
    // List form and `true` entries allow any prop (built-ins still apply).
    expect(checkHostProp("a", "id", "z", { elements: ["a"] })).toBeNull();
  });
});

describe("render-time enforcement", () => {
  it("drops a string style instead of letting React throw", () => {
    expect(toHtml(`<div style="color:red">hi</div>`)).toBe("<div>hi</div>");
  });

  it("renders a style variable that resolves to an object", () => {
    expect(
      toHtml(`<div style={theme.card}>hi</div>`, {
        variables: { theme: { card: { color: "red" } } },
      }),
    ).toBe(`<div style="color:red">hi</div>`);
  });

  it("drops unsafe URLs and keeps safe ones", () => {
    expect(toHtml(`<a href="javascript:alert(1)">x</a>`)).toBe("<a>x</a>");
    expect(toHtml(`<a href="/docs">x</a>`)).toBe(`<a href="/docs">x</a>`);
  });

  it("drops string event handlers", () => {
    expect(toHtml(`<button onClick="alert(1)">go</button>`)).toBe("<button>go</button>");
  });

  it("wires an on* handler through a predefined variable", () => {
    const go = vi.fn();
    const core = createParser();
    core.write(`<button onClick={actions.go}>hit</button>`);
    core.end();
    const renderer = createRenderer({ variables: { actions: { go } } });
    const { getByText } = render(createElement(Fragment, null, renderer.render(core.getTree())));
    fireEvent.click(getByText("hit"));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("skips an element outside the allowlist (default behavior)", () => {
    expect(toHtml(`<div><script>alert(1)</script>ok</div>`, { elements: ["div"] })).toBe(
      "<div>ok</div>",
    );
  });

  it("can render a disallowed element as the Pending placeholder", () => {
    const Marker = (): ReactNode => createElement("em", null, "…");
    expect(
      toHtml(`<div><iframe src="x"></iframe></div>`, {
        elements: ["div"],
        onDisallowedElement: "pending",
        Pending: Marker,
      }),
    ).toBe("<div><em>…</em></div>");
  });

  it("drops props outside a per-tag allowlist", () => {
    expect(toHtml(`<a href="/x" id="z">t</a>`, { elements: { a: ["href"] } })).toBe(
      `<a href="/x">t</a>`,
    );
  });

  it("applies the allowlist to nested JSX inside an expression", () => {
    expect(toHtml(`<div>{<script>x</script>}</div>`, { elements: ["div"] })).toBe("<div></div>");
  });
});

describe("parse-time events through the React adapter", () => {
  it("reports disallowed elements and invalid props with locations", async () => {
    async function* source(): AsyncGenerator<string> {
      yield `<script src="x"></script>`;
      yield `<div style="color:red">a</div>`;
    }
    const events: JsxErrorEvent[] = [];
    const parser = createIncrementalJsxParser(source(), {
      elements: ["div"],
      onJsxError: (event) => events.push(event),
    });
    await parser.done;

    const disallowed = events.find((e) => e.kind === "disallowed-element");
    expect(disallowed).toMatchObject({ tag: "script" });
    expect(disallowed?.location.line).toBe(1);
    expect(disallowed?.location.column).toBe(1);

    const invalid = events.find((e) => e.kind === "invalid-prop");
    expect(invalid).toMatchObject({ tag: "div", prop: "style" });
    expect(invalid && invalid.kind === "invalid-prop" && invalid.reason.length > 0).toBe(true);
  });

  it("stays quiet for schema-conforming input", async () => {
    async function* source(): AsyncGenerator<string> {
      yield `<div><a href="/x">ok</a></div>`;
    }
    const events: JsxErrorEvent[] = [];
    const parser = createIncrementalJsxParser(source(), {
      elements: { div: true, a: ["href"] },
      onJsxError: (event) => events.push(event),
    });
    await parser.done;
    expect(events).toEqual([]);
  });
});

describe("formatPromptContract", () => {
  it("describes the configured elements, components, and variables", () => {
    const contract = formatPromptContract({
      elements: { div: true, a: ["href", "title"] },
      components: { Card: () => null },
      variables: { user: { name: "Ada", age: 42 }, actions: { proceed: () => {} } },
    });
    expect(contract).toContain("- <div>");
    expect(contract).toContain("- <a> — allowed props: href, title");
    expect(contract).toContain("- <Card>");
    expect(contract).toContain("- {user} — object with fields: name (string), age (number)");
    expect(contract).toContain("- {actions} — object with fields: proceed (function)");
    expect(contract).toContain("dangerouslySetInnerHTML");
    // Shapes only — variable values must never leak into the contract.
    expect(contract).not.toContain("Ada");
  });

  it("falls back to sensible wording when nothing is configured", () => {
    const contract = formatPromptContract();
    expect(contract).toContain("Any standard lowercase HTML element is allowed.");
    expect(contract).toContain("No components are available");
    expect(contract).toContain("No variables are defined");
  });
});
