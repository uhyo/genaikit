import { describe, expect, it } from "vitest";

import { createPushChannel } from "./channel";

async function drain(source: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of source) out.push(chunk);
  return out;
}

describe("createPushChannel", () => {
  it("delivers chunks pushed before and while the consumer waits, in order", async () => {
    const channel = createPushChannel();
    channel.push("a");
    channel.push("b");
    const drained = drain(channel.source);
    await Promise.resolve();
    channel.push("c");
    channel.close();
    expect(await drained).toEqual(["a", "b", "c"]);
  });

  it("wakes a waiting consumer on close", async () => {
    const channel = createPushChannel();
    const drained = drain(channel.source);
    await Promise.resolve();
    channel.close();
    expect(await drained).toEqual([]);
  });

  it("drops empty chunks and pushes after close; close is idempotent", async () => {
    const channel = createPushChannel();
    channel.push("");
    channel.push("x");
    channel.close();
    channel.push("late");
    channel.close();
    expect(await drain(channel.source)).toEqual(["x"]);
  });
});
