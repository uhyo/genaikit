import { act, cleanup, render } from "@testing-library/react";
import { Children } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPushChannel } from "./channel";
import type { GenUiIssue } from "./issues";
import { createGenUiMessage } from "./message";
import { useGenUiNode } from "./react";

function html(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>);
}

async function* iterableFrom(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

/** Let the background pumps (outer stream + per-block channels) drain. */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

afterEach(() => {
  // With `globals: false`, testing-library's automatic cleanup does not
  // register; unmount explicitly so renders don't leak across tests.
  cleanup();
  vi.restoreAllMocks();
});

describe("createGenUiMessage — rendering", () => {
  it("renders a markdown-only message", async () => {
    const message = createGenUiMessage(iterableFrom(["# Hi\n\nSome **bold** text.\n"]));
    await message.done;
    expect(html(message.getSnapshot())).toBe("<h1>Hi</h1><p>Some <strong>bold</strong> text.</p>");
    expect(message.getIssues()).toEqual([]);
    expect(message.getIssueReport()).toBeNull();
  });

  it("renders ui+jsx blocks as live UI between markdown regions", async () => {
    const Card = ({ title }: { title?: string }) => <section>{title}</section>;
    const message = createGenUiMessage(
      iterableFrom(["Before.\n\n```ui+jsx\n", '<Card title="Hello" />\n', "```\n\nAfter.\n"]),
      { components: { Card } },
    );
    await message.done;
    expect(html(message.getSnapshot())).toBe("<p>Before.</p><section>Hello</section><p>After.</p>");
    expect(message.getIssueReport()).toBeNull();
  });

  it("renders a regular code fence as code, not UI", async () => {
    const message = createGenUiMessage(iterableFrom(["```js\nlet x = 1;\n```\n"]));
    await message.done;
    expect(html(message.getSnapshot())).toBe(
      '<pre><code class="language-js">let x = 1;\n</code></pre>',
    );
  });

  it("keeps a stable snapshot reference until the content changes", async () => {
    const message = createGenUiMessage(iterableFrom(["hello\n"]));
    await message.done;
    const a = message.getSnapshot();
    expect(message.getSnapshot()).toBe(a);
  });

  it("reuses settled markdown region elements across snapshots", async () => {
    const outer = createPushChannel();
    const message = createGenUiMessage(outer.source);
    outer.push("First paragraph.\n\n```ui+jsx\n<div/>\n```\n");
    await settle();
    const before = message.getSnapshot() as ReactNode[];
    outer.push("tail text");
    await settle();
    const after = message.getSnapshot() as ReactNode[];
    expect(after).not.toBe(before);
    // The settled first region keeps its element identity.
    expect(after[0]).toBe(before[0]);
    outer.close();
    await message.done;
  });

  it("shows the Pending placeholder at a markdown frontier while streaming", async () => {
    const Pending = () => <span className="shimmer" />;
    const outer = createPushChannel();
    const message = createGenUiMessage(outer.source, { Pending });
    outer.push("Loading text");
    await settle();
    expect(html(message.getSnapshot())).toBe('<p>Loading text</p><span class="shimmer"></span>');
    outer.close();
    await message.done;
    expect(html(message.getSnapshot())).toBe("<p>Loading text</p>");
  });

  it("shows the Pending placeholder inside a streaming ui block", async () => {
    const Pending = () => <span className="shimmer" />;
    const outer = createPushChannel();
    const message = createGenUiMessage(outer.source, { Pending });
    outer.push("```ui+jsx\n<div>partial");
    await settle();
    expect(html(message.getSnapshot())).toBe('<div>partial<span class="shimmer"></span></div>');
    outer.close();
    await message.done;
  });

  it("supports a custom markdown renderer", async () => {
    const message = createGenUiMessage(iterableFrom(["hello\n"]), {
      renderMarkdown: (markdown) => <div data-md={markdown.trim()} />,
    });
    await message.done;
    expect(html(message.getSnapshot())).toBe('<div data-md="hello"></div>');
  });
});

describe("createGenUiMessage — actions", () => {
  it("wires actions into the UI and emits ActionEvents on invocation", async () => {
    const fired: string[] = [];
    const submitted = vi.fn();
    const message = createGenUiMessage(
      iterableFrom(["```ui+jsx\n<button onClick={actions.submit}>Go</button>\n```\n"]),
      {
        actions: { submit: submitted },
        onAction: (event) => fired.push(event.message),
      },
    );
    await message.done;
    expect(message.getIssueReport()).toBeNull();

    const { getByRole } = render(<>{message.getSnapshot()}</>);
    act(() => {
      getByRole("button").click();
    });

    expect(submitted).toHaveBeenCalledOnce();
    expect(fired).toEqual(["The `actions.submit` action was fired by the user."]);
  });

  it("reports a reference to an undeclared action as an issue", async () => {
    const issues: GenUiIssue[] = [];
    const message = createGenUiMessage(
      iterableFrom(["```ui+jsx\n<button onClick={actions.launch}>Go</button>\n```\n"]),
      { actions: { submit: true }, onIssue: (issue) => issues.push(issue) },
    );
    await message.done;
    expect(issues.map((i) => i.kind)).toEqual(["jsx-error"]);
    expect(message.getIssueReport()).toContain("actions.launch");
  });

  it("accepts model-defined actions when dynamicActions is on", async () => {
    const fired: { name: string; declared: boolean; message: string }[] = [];
    const message = createGenUiMessage(
      iterableFrom(["```ui+jsx\n<button onClick={actions.choosePlanPro}>Pro</button>\n```\n"]),
      {
        dynamicActions: true,
        onAction: ({ name, declared, message: text }) =>
          fired.push({ name, declared, message: text }),
      },
    );
    await message.done;
    expect(message.getIssues()).toEqual([]);

    const { getByRole } = render(<>{message.getSnapshot()}</>);
    act(() => {
      getByRole("button").click();
    });

    expect(fired).toEqual([
      {
        name: "choosePlanPro",
        declared: false,
        message: "The `actions.choosePlanPro` action was fired by the user.",
      },
    ]);
  });

  it("mixes declared handlers with dynamic actions", async () => {
    const submitted = vi.fn();
    const fired: [string, boolean][] = [];
    const message = createGenUiMessage(
      iterableFrom([
        "```ui+jsx\n<div><button onClick={actions.submit}>Send</button>",
        "<button onClick={actions.dismissHelp}>Dismiss</button></div>\n```\n",
      ]),
      {
        actions: { submit: submitted },
        dynamicActions: true,
        onAction: (event) => fired.push([event.name, event.declared]),
      },
    );
    await message.done;
    expect(message.getIssues()).toEqual([]);

    const { getAllByRole } = render(<>{message.getSnapshot()}</>);
    act(() => {
      for (const button of getAllByRole("button")) button.click();
    });

    expect(submitted).toHaveBeenCalledOnce();
    expect(fired).toEqual([
      ["submit", true],
      ["dismissHelp", false],
    ]);
  });
});

describe("createGenUiMessage — issues", () => {
  it("collects parser errors per block with block indices", async () => {
    const message = createGenUiMessage(
      iterableFrom(["```ui+jsx\n<Unknown />\n```\n\n", "```ui+jsx\n<div>{1 + 2}</div>\n```\n"]),
      { components: {} },
    );
    await message.done;
    const issues = message.getIssues();
    expect(issues.map((i) => [i.blockIndex, i.kind])).toEqual([
      [0, "jsx-error"],
      [1, "jsx-error"],
    ]);
    const report = message.getIssueReport()!;
    expect(report).toContain("In `ui+jsx` block 1:");
    expect(report).toContain("In `ui+jsx` block 2:");
  });

  it("reports an unclosed ui+jsx fence", async () => {
    const message = createGenUiMessage(iterableFrom(["```ui+jsx\n<div>hi</div>\n"]));
    await message.done;
    expect(message.getIssues().map((i) => i.kind)).toEqual(["unclosed-fence"]);
    expect(html(message.getSnapshot())).toBe("<div>hi</div>");
  });

  it("hides a block that crashes at render time and records a render-error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = () => {
      throw new Error("component exploded");
    };
    const issues: GenUiIssue[] = [];
    const message = createGenUiMessage(iterableFrom(["ok\n\n```ui+jsx\n<Boom />\n```\n"]), {
      components: { Boom },
      onIssue: (issue) => issues.push(issue),
      renderUiError: (blockIndex) => <em>block {blockIndex + 1} hidden</em>,
    });
    await message.done;

    const { container } = render(<>{message.getSnapshot()}</>);
    expect(container.innerHTML).toBe("<p>ok</p><em>block 1 hidden</em>");
    expect(issues.map((i) => i.kind)).toEqual(["render-error"]);
    expect(message.getIssueReport()).toContain("Rendering crashed: component exploded");
  });

  it("retries a crashed block as more of the stream arrives (self-healing)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = ({ children }: { children?: ReactNode }) => {
      const text = Children.toArray(children)
        .filter((child): child is string => typeof child === "string")
        .join("");
      if (text === "bad") throw new Error("transiently bad");
      return <b>{text}</b>;
    };
    const outer = createPushChannel();
    const message = createGenUiMessage(outer.source, { components: { Boom } });
    const View = () => <>{useGenUiNode(message)}</>;
    const { container } = render(<View />);

    await act(async () => {
      outer.push("```ui+jsx\n<Boom>bad");
      await settle();
    });
    // The partial text crashed the component; the boundary hides the block.
    expect(container.innerHTML).toBe("");

    await act(async () => {
      outer.push("ge</Boom>\n```\n");
      outer.close();
      await settle();
    });
    await act(async () => {
      await message.done;
    });
    expect(container.innerHTML).toBe("<b>badge</b>");
  });
});

describe("createGenUiMessage — lifecycle", () => {
  it("rejects done and reports onStreamError when the source fails", async () => {
    const failure = new Error("network down");
    async function* failing(): AsyncGenerator<string> {
      yield "some text\n\n```ui+jsx\n<div>partial";
      throw failure;
    }
    const onStreamError = vi.fn();
    const message = createGenUiMessage(failing(), { onStreamError });
    await expect(message.done).rejects.toBe(failure);
    expect(onStreamError).toHaveBeenCalledWith(failure);
    await settle();
    // Received content stays rendered, finalized best-effort.
    expect(html(message.getSnapshot())).toBe("<p>some text</p><div>partial</div>");
  });

  it("dispose cancels the stream", async () => {
    const outer = createPushChannel();
    const message = createGenUiMessage(outer.source);
    outer.push("hello");
    await settle();
    message.dispose();
    outer.push(" more");
    await settle();
    expect(html(message.getSnapshot())).toBe("<p>hello</p>");
  });

  it("notifies subscribers as chunks arrive", async () => {
    const outer = createPushChannel();
    const message = createGenUiMessage(outer.source);
    let notified = 0;
    const unsubscribe = message.subscribe(() => notified++);
    outer.push("a");
    await settle();
    expect(notified).toBeGreaterThan(0);
    unsubscribe();
    outer.close();
    await message.done;
  });
});
