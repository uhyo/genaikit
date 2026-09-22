import { describe, expect, it, vi } from "vitest";

import type { ActionEvent } from "./actions";
import { createActionsVariable, formatActionMessage } from "./actions";

describe("formatActionMessage", () => {
  it("produces the canonical next-request text", () => {
    expect(formatActionMessage("submit")).toBe(
      "The `actions.submit` action was fired by the user.",
    );
  });
});

describe("createActionsVariable", () => {
  it("declares every action as a function", () => {
    const { type } = createActionsVariable({ submit: true, cancel: () => {} }, undefined);
    expect(type).toEqual({ submit: "function", cancel: "function" });
  });

  it("emits an ActionEvent and runs the host handler", () => {
    const events: ActionEvent[] = [];
    const handler = vi.fn();
    const { values } = createActionsVariable({ submit: handler }, (event) => events.push(event));

    values["submit"]!("arg0", 1);

    expect(handler).toHaveBeenCalledWith("arg0", 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "submit",
      reference: "actions.submit",
      message: "The `actions.submit` action was fired by the user.",
      args: ["arg0", 1],
    });
  });

  it("supports handler-less actions declared as true", () => {
    const events: ActionEvent[] = [];
    const { values } = createActionsVariable({ ping: true }, (event) => events.push(event));
    values["ping"]!();
    expect(events.map((e) => e.name)).toEqual(["ping"]);
  });

  it("works without an onAction listener", () => {
    const handler = vi.fn();
    const { values } = createActionsVariable({ go: handler }, undefined);
    values["go"]!();
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("createActionsVariable — dynamic", () => {
  it("resolves any name to a stable, firing action function", () => {
    const events: ActionEvent[] = [];
    const { values } = createActionsVariable({}, (event) => events.push(event), true);

    expect("choosePlanPro" in values).toBe(true);
    const fn = values["choosePlanPro"]!;
    expect(typeof fn).toBe("function");
    expect(values["choosePlanPro"]).toBe(fn); // stable identity per name

    fn("payload");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "choosePlanPro",
      reference: "actions.choosePlanPro",
      message: "The `actions.choosePlanPro` action was fired by the user.",
      args: ["payload"],
      declared: false,
    });
  });

  it("keeps declared handlers alongside dynamic names", () => {
    const events: ActionEvent[] = [];
    const handler = vi.fn();
    const { values, type } = createActionsVariable(
      { submit: handler },
      (event) => events.push(event),
      true,
    );

    values["submit"]!();
    values["somethingElse"]!();

    expect(handler).toHaveBeenCalledOnce(); // only the declared action runs host code
    expect(events.map((e) => [e.name, e.declared])).toEqual([
      ["submit", true],
      ["somethingElse", false],
    ]);
    // The declared shape is unchanged; dynamic names resolve via the value.
    expect(type).toEqual({ submit: "function" });
  });

  it("leaves inherited Object.prototype members untouched", () => {
    const events: ActionEvent[] = [];
    const { values } = createActionsVariable({}, (event) => events.push(event), true);
    expect(values["toString"]).toBe(Object.prototype.toString);
    expect(String(values)).toBe("[object Object]");
    expect(events).toEqual([]);
  });

  it("only enumerates declared actions (dynamic names stay lazy)", () => {
    const { values } = createActionsVariable({ submit: true }, undefined, true);
    void values["invented"];
    expect(Object.keys(values)).toEqual(["submit"]);
  });
});
