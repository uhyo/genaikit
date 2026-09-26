import { describe, expect, it } from "vitest";

import type { GenUiIssue } from "./issues";
import { pipeGenUi } from "./pipe";
import { defineGenUiSchema } from "./schema";

const schema = defineGenUiSchema({ components: { Card: { props: { title: "string" } } } });

async function* iterableFrom<T>(chunks: T[]): AsyncGenerator<T> {
  for (const chunk of chunks) yield chunk;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe("pipeGenUi", () => {
  it("passes the text through unchanged and resolves with the issues", async () => {
    const chunks = ["Hi\n```ui+", "jsx\n<Card title={1} />\n", "<Chart />\n```\n", "bye"];
    const pipe = pipeGenUi(iterableFrom(chunks), schema);
    expect(await readAll(pipe.stream)).toBe(chunks.join(""));
    const issues = await pipe.done;
    expect(issues.map((issue) => issue.kind === "jsx-error" && issue.event.kind)).toEqual([
      "invalid-prop",
      "unknown-component",
    ]);
    expect(pipe.getIssueReport()).toContain("<Chart>");
  });

  it("reports an issue before the chunk completing it reaches the consumer", async () => {
    const seen: GenUiIssue[] = [];
    const pipe = pipeGenUi(iterableFrom(["```ui+jsx\n", "<Chart />", "\n```\n"]), schema, {
      onIssue: (issue) => seen.push(issue),
    });
    const reader = pipe.stream.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe("```ui+jsx\n");
    expect(seen).toEqual([]);
    expect(decoder.decode((await reader.read()).value)).toBe("<Chart />");
    expect(seen).toHaveLength(1);
    reader.releaseLock();
  });

  it("decodes byte sources, including code points split across chunks", async () => {
    const bytes = new TextEncoder().encode('```ui+jsx\n<Card title="héllo 👋" />\n```\n');
    const parts = [bytes.slice(0, 22), bytes.slice(22, 27), bytes.slice(27)];
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    });
    const pipe = pipeGenUi(source, schema);
    expect(await readAll(pipe.stream)).toBe('```ui+jsx\n<Card title="héllo 👋" />\n```\n');
    expect(await pipe.done).toEqual([]);
  });

  it("skips empty chunks without stalling", async () => {
    const pipe = pipeGenUi(iterableFrom(["", "a", "", "", "b", ""]), schema);
    expect(await readAll(pipe.stream)).toBe("ab");
  });

  it("cancels the source when the consumer cancels", async () => {
    let cancelled = false;
    const source = new ReadableStream<string>({
      pull(controller) {
        controller.enqueue("```ui+jsx\n<Chart />\n");
      },
      cancel() {
        cancelled = true;
      },
    });
    const pipe = pipeGenUi(source, schema);
    const reader = pipe.stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toBe(true);
    // No end-of-message checks after a cancel (no unclosed-fence).
    const kinds = (await pipe.done).map((issue) => issue.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds).not.toContain("unclosed-fence");
  });

  it("errors the stream and rejects done when the source fails", async () => {
    const failure = new Error("upstream failed");
    async function* failing(): AsyncGenerator<string> {
      yield "partial ";
      throw failure;
    }
    const pipe = pipeGenUi(failing(), schema);
    const reader = pipe.stream.getReader();
    await reader.read();
    await expect(reader.read()).rejects.toBe(failure);
    await expect(pipe.done).rejects.toBe(failure);
  });
});
