import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GenUiMessage } from "./message";
import { useGenUiMessage } from "./react";

async function* iterableFrom(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("useGenUiMessage", () => {
  it("streams a source into the live tree and exposes the message store", async () => {
    const source = iterableFrom(["# Title\n\n```ui+jsx\n<div>ui</div>\n```\n"]);
    let message: GenUiMessage | undefined;
    const View = () => {
      const hook = useGenUiMessage(source);
      message = hook.message;
      return <main>{hook.node}</main>;
    };
    const { container } = render(<View />);
    await act(async () => {
      await message!.done;
      await settle();
    });
    expect(container.innerHTML).toBe("<main><h1>Title</h1><div>ui</div></main>");
    expect(message!.getIssueReport()).toBeNull();
  });
});
