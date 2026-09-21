import { describe, expect, it } from "vitest";

import { formatGenUiPrompt } from "./prompt";

describe("formatGenUiPrompt", () => {
  it("describes the message format", () => {
    const prompt = formatGenUiPrompt();
    expect(prompt).toContain("## Message format");
    expect(prompt).toContain("```ui+jsx");
    expect(prompt).toContain("close every ui+jsx fence");
    // No actions configured -> no Actions section.
    expect(prompt).not.toContain("## Actions");
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
  it("tells the model it may define its own actions", () => {
    const prompt = formatGenUiPrompt({ dynamicActions: true });
    expect(prompt).toContain("## Actions");
    expect(prompt).toContain("define your own actions");
    expect(prompt).toContain("`actions.<name>`");
    expect(prompt).toContain("onClick={actions.submitForm}");
    expect(prompt).toContain('"The `actions.submitForm` action was fired by the user."');
    expect(prompt).toContain("- {actions} —");
  });

  it("lists declared actions alongside the dynamic note, using one as the example", () => {
    const prompt = formatGenUiPrompt({ actions: { submit: true }, dynamicActions: true });
    expect(prompt).toContain("- Available actions: `actions.submit`.");
    expect(prompt).toContain("define your own actions");
    expect(prompt).toContain("onClick={actions.submit}");
  });

  it("does not mention self-defined actions by default", () => {
    const prompt = formatGenUiPrompt({ actions: { submit: true } });
    expect(prompt).not.toContain("define your own actions");
  });
});
