import { describe, expect, it } from "vitest";

import { bindGenUi } from "./bind";
import { formatGenUiPrompt } from "./prompt";
import { defineGenUiSchema } from "./schema";

describe("formatGenUiPrompt", () => {
  it("describes the message format", () => {
    const prompt = formatGenUiPrompt();
    expect(prompt).toContain("## Message format");
    expect(prompt).toContain("```ui+jsx");
    expect(prompt).toContain("close every ui+jsx fence");
    // Dynamic actions are the default, so the Actions section is always there
    // unless opted out.
    expect(prompt).toContain("## Actions");
  });

  it("embeds the parser's prompt contract", () => {
    const prompt = formatGenUiPrompt({ elements: { div: true, a: { href: "url" } } });
    expect(prompt).toContain("## UI contract");
    expect(prompt).toContain("- <div>");
    expect(prompt).toContain("- <a> — allowed props: href (URL string)");
  });

  it("lists the available actions and their firing semantics", () => {
    const prompt = formatGenUiPrompt({ actions: { submit: true, cancel: () => {} } });
    expect(prompt).toContain("## Actions");
    expect(prompt).toContain("`actions.submit`, `actions.cancel`");
    expect(prompt).toContain("onClick={actions.submit}");
    expect(prompt).toContain('"The `actions.submit` action was fired by the user."');
  });

  it("declares the actions variable in the contract's predefined variables", () => {
    const prompt = formatGenUiPrompt({ actions: { submit: true } });
    expect(prompt).toContain("- {actions} — object with fields: submit (function)");
  });

  it("keeps user variables alongside the actions variable", () => {
    const prompt = formatGenUiPrompt({
      actions: { submit: true },
      variables: { user: { name: "u" } },
      variableTypes: { user: { name: "string" } },
    });
    expect(prompt).toContain("- {user} — object with fields: name (string)");
    expect(prompt).toContain("- {actions} —");
  });
});

describe("formatGenUiPrompt — dynamic actions", () => {
  it("tells the model it may define its own actions (the default)", () => {
    const prompt = formatGenUiPrompt();
    expect(prompt).toContain("## Actions");
    expect(prompt).toContain("define your own actions");
    expect(prompt).toContain("`actions.<name>`");
    expect(prompt).toContain("onClick={actions.submitForm}");
    expect(prompt).toContain('"The `actions.submitForm` action was fired by the user."');
    expect(prompt).toContain("- {actions} —");
  });

  it("lists declared actions alongside the dynamic note, using one as the example", () => {
    const prompt = formatGenUiPrompt({ actions: { submit: true } });
    expect(prompt).toContain("- Available actions: `actions.submit`.");
    expect(prompt).toContain("define your own actions");
    expect(prompt).toContain("onClick={actions.submit}");
  });

  it("omits self-defined actions when opted out", () => {
    const prompt = formatGenUiPrompt({ actions: { submit: true }, dynamicActions: false });
    expect(prompt).toContain("- Available actions: `actions.submit`.");
    expect(prompt).not.toContain("define your own actions");
  });

  it("omits the Actions section entirely when opted out with no declared actions", () => {
    const prompt = formatGenUiPrompt({ dynamicActions: false });
    expect(prompt).not.toContain("## Actions");
    expect(prompt).not.toContain("- {actions} —");
  });
});

describe("formatGenUiPrompt — from a GenUiSchema", () => {
  const schema = defineGenUiSchema({
    elements: { div: true },
    components: {
      Card: { props: { title: "string" }, description: "A titled panel." },
      Free: true,
    },
    variableTypes: { user: { name: "string" } },
    actions: { subscribe: { description: "Start a subscription." }, cancel: true },
  });

  it("describes components, variables, and actions from the data-only schema", () => {
    const prompt = formatGenUiPrompt(schema);
    expect(prompt).toContain("- <Card> — allowed props: title (string)\n  A titled panel.");
    expect(prompt).toContain("- <Free>");
    expect(prompt).toContain("- {user} — object with fields: name (string)");
    expect(prompt).toContain(
      "- {actions} — object with fields: subscribe (function), cancel (function)",
    );
  });

  it("lists actions with their descriptions", () => {
    const prompt = formatGenUiPrompt(schema);
    expect(prompt).toContain(
      "- Available actions:\n  - `actions.subscribe`: Start a subscription.\n  - `actions.cancel`\n",
    );
    expect(prompt).toContain("onClick={actions.subscribe}");
  });

  it("matches the prompt built from the bound client options", () => {
    const Card = () => null;
    const Free = () => null;
    const bound = bindGenUi(schema, {
      components: { Card, Free },
      variables: { user: { name: "u" } },
    });
    expect(formatGenUiPrompt(bound)).toBe(formatGenUiPrompt(schema));
  });
});
