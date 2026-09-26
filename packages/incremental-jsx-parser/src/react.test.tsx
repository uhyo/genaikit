import { act, render } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { useIncrementalJsx, useIsElementComplete } from "./react";

/** A ReadableStream whose chunks are pushed manually by the test. */
function controllable(): {
  stream: ReadableStream<string>;
  push: (chunk: string) => void;
  close: () => void;
} {
  let controller!: ReadableStreamDefaultController<string>;
  const stream = new ReadableStream<string>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    push: (chunk) => controller.enqueue(chunk),
    close: () => controller.close(),
  };
}

/** Let the background stream pump and React effects settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function Pending(): ReactNode {
  return <span data-testid="pending">…</span>;
}

function Card({ children }: { children?: ReactNode }): ReactNode {
  return <section className="card">{children}</section>;
}

function Streamed({ stream }: { stream: ReadableStream<string> }): ReactNode {
  return useIncrementalJsx(stream, { Pending });
}

describe("useIncrementalJsx", () => {
  it("renders the tree as it streams and drops Pending on completion", async () => {
    const { stream, push, close } = controllable();
    const { container } = render(<Streamed stream={stream} />);

    push("<div>Hello");
    await flush();
    expect(container.innerHTML).toBe('<div>Hello<span data-testid="pending">…</span></div>');

    push(" <b>world</b>");
    await flush();
    expect(container.innerHTML).toBe(
      '<div>Hello <b>world</b><span data-testid="pending">…</span></div>',
    );

    push("</div>");
    close();
    await flush();
    expect(container.innerHTML).toBe("<div>Hello <b>world</b></div>");
  });

  it("resolves components from the options map", async () => {
    function Comp({ stream }: { stream: ReadableStream<string> }): ReactNode {
      return useIncrementalJsx(stream, { components: { Card } });
    }

    const { stream, push, close } = controllable();
    const { container } = render(<Comp stream={stream} />);

    push("<Card>hi</Card>");
    close();
    await flush();
    expect(container.innerHTML).toBe('<section class="card">hi</section>');
  });

  it("flips useIsElementComplete when the closing tag arrives, without remounting", async () => {
    let mounts = 0;
    function Status({ children }: { children?: ReactNode }): ReactNode {
      const complete = useIsElementComplete();
      useEffect(() => {
        mounts++;
      }, []);
      return <p data-complete={String(complete)}>{children}</p>;
    }
    function Comp({ stream }: { stream: ReadableStream<string> }): ReactNode {
      return useIncrementalJsx(stream, { components: { Status } });
    }

    const { stream, push, close } = controllable();
    const { container } = render(<Comp stream={stream} />);

    push("<div><Status>a");
    await flush();
    expect(container.innerHTML).toBe('<div><p data-complete="false">a</p></div>');

    push("b</Status>");
    await flush();
    expect(container.innerHTML).toBe('<div><p data-complete="true">ab</p></div>');

    push("</div>");
    close();
    await flush();
    expect(container.innerHTML).toBe('<div><p data-complete="true">ab</p></div>');
    expect(mounts).toBe(1);
  });

  it("cancels the stream on unmount", async () => {
    let cancelled = false;
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("<div>x");
      },
      cancel() {
        cancelled = true;
      },
    });
    const { container, unmount } = render(<Streamed stream={stream} />);
    await flush();
    expect(container.innerHTML).toBe('<div>x<span data-testid="pending">…</span></div>');

    unmount();
    await flush();
    expect(cancelled).toBe(true);
  });
});
