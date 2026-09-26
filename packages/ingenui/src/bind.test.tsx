import type { ReactNode } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { ActionEvent } from "./actions";
import type { InferComponentProps, InferSchemaType } from "./bind";
import { bindGenUi } from "./bind";
import type { GenUiIssue } from "./issues";
import { createGenUiMessage } from "./message";
import { defineGenUiSchema } from "./schema";

async function* iterableFrom(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

const schema = defineGenUiSchema({
  elements: { div: true, button: { onClick: "function" } },
  components: {
    Card: { props: { title: "string" }, description: "A titled panel." },
    Stat: { props: { value: ["string", "number"], onPick: "function" } },
    Free: true,
  },
  variableTypes: { user: { name: "string" } },
  actions: { submit: true, cancel: { description: "Cancel." } },
});

function Card({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <section>
      {title}:{children}
    </section>
  );
}
function Stat({ value }: { value?: string | number; onPick?: (id: string) => void }) {
  return <b>{value}</b>;
}
function Free(props: Record<string, unknown>) {
  return <i>{Object.keys(props).join(",")}</i>;
}

describe("bindGenUi", () => {
  it("produces message options that render the schema's catalog", async () => {
    const genUi = bindGenUi(schema, {
      components: { Card, Stat, Free },
      variables: { user: { name: "uhyo" } },
    });
    const message = createGenUiMessage(
      iterableFrom(["```ui+jsx\n<Card title={user.name}><Stat value={42} /></Card>\n```\n"]),
      genUi,
    );
    await message.done;
    expect(renderToStaticMarkup(<>{message.getSnapshot()}</>)).toBe(
      "<section>uhyo:<b>42</b></section>",
    );
    expect(message.getIssues()).toEqual([]);
    expect(Object.keys(genUi.actions ?? {})).toEqual(["submit", "cancel"]);
  });

  it("wires declared action handlers and keeps descriptions", async () => {
    const submit = vi.fn();
    const events: ActionEvent[] = [];
    const genUi = bindGenUi(schema, {
      components: { Card, Stat, Free },
      variables: { user: { name: "u" } },
      actions: { submit },
    });
    expect(genUi.components?.["Card"]).toMatchObject({
      component: Card,
      props: { title: "string" },
      description: "A titled panel.",
    });
    expect(genUi.actions?.["cancel"]).toEqual({ description: "Cancel." });

    // Click through a rendered button to fire the bound handler.
    const message = createGenUiMessage(
      iterableFrom(["```ui+jsx\n<button onClick={actions.submit}>go</button>\n```\n"]),
      { ...genUi, onAction: (event) => events.push(event) },
    );
    await message.done;
    const view = render(<>{message.getSnapshot()}</>);
    fireEvent.click(view.getByText("go"));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(events.map((event) => [event.name, event.declared])).toEqual([["submit", true]]);
    cleanup();
  });

  it("reports the same issues as the schema promises (unknown props, variables)", async () => {
    const genUi = bindGenUi(schema, {
      components: { Card, Stat, Free },
      variables: { user: { name: "u" } },
    });
    const issues: GenUiIssue[] = [];
    const message = createGenUiMessage(
      iterableFrom(['```ui+jsx\n<Card tone="x" /><Chart />{user.age}\n```\n']),
      { ...genUi, onIssue: (issue) => issues.push(issue) },
    );
    await message.done;
    expect(
      issues.map((issue) => issue.kind === "jsx-error" && issue.event.kind).toSorted(),
    ).toEqual(["invalid-prop", "unknown-component", "unknown-variable"]);
  });

  it("throws on a missing or undeclared binding", () => {
    expect(() =>
      // @ts-expect-error -- Free is missing
      bindGenUi(schema, { components: { Card, Stat }, variables: { user: { name: "u" } } }),
    ).toThrow('no implementation bound for component "Free"');
    expect(() =>
      bindGenUi(schema, {
        // @ts-expect-error -- Extra is not declared
        components: { Card, Stat, Free, Extra: Free },
        variables: { user: { name: "u" } },
      }),
    ).toThrow('component "Extra" is not declared in the schema');
    expect(() =>
      // @ts-expect-error -- user is missing
      bindGenUi(schema, { components: { Card, Stat, Free }, variables: {} }),
    ).toThrow('no implementation bound for variable "user"');
    expect(() =>
      bindGenUi(schema, {
        components: { Card, Stat, Free },
        variables: { user: { name: "u" } },
        // @ts-expect-error -- only declared actions take handlers
        actions: { other: () => {} },
      }),
    ).toThrow('action "other" is not declared in the schema');
  });

  it("binds an empty schema with no bindings", () => {
    const genUi = bindGenUi(defineGenUiSchema({}), {});
    expect(genUi.components).toEqual({});
    expect(genUi.variables).toEqual({});
  });
});

describe("bindGenUi — types", () => {
  it("infers TypeScript types from schema types", () => {
    expectTypeOf<InferSchemaType<"string">>().toEqualTypeOf<string>();
    expectTypeOf<InferSchemaType<"url">>().toEqualTypeOf<string>();
    expectTypeOf<InferSchemaType<"node">>().toEqualTypeOf<ReactNode>();
    expectTypeOf<InferSchemaType<readonly ["string", "number"]>>().toEqualTypeOf<string | number>();
    expectTypeOf<
      InferSchemaType<{ readonly name: "string"; readonly n: "number" }>
    >().toEqualTypeOf<{ name: string; n: number }>();
    expectTypeOf<
      InferComponentProps<{ readonly props: { readonly title: "string" } }>
    >().toEqualTypeOf<{ title?: string } & { children?: ReactNode }>();
  });

  it("checks component props and variable values against the schema", () => {
    function Wrong({ title }: { title: number }) {
      return <>{title}</>;
    }
    function Required({ title }: { title: string }) {
      return <>{title}</>;
    }
    const bind = () => {
      bindGenUi(schema, {
        // @ts-expect-error -- title is declared "string", not number
        components: { Card: Wrong, Stat, Free },
        variables: { user: { name: "u" } },
      });
      bindGenUi(schema, {
        // @ts-expect-error -- the model may omit title, so it must be optional
        components: { Card: Required, Stat, Free },
        variables: { user: { name: "u" } },
      });
      bindGenUi(schema, {
        components: { Card, Stat, Free },
        // @ts-expect-error -- user.name is declared "string"
        variables: { user: { name: 1 } },
      });
    };
    expect(bind).toBeTypeOf("function");
  });
});
