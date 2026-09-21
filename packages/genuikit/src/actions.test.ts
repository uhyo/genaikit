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
