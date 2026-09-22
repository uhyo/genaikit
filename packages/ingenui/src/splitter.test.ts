import { describe, expect, it } from "vitest";

import { createFenceSplitter } from "./splitter";

/** Structured recording of every splitter callback. */
interface Recording {
  /** Region contents in order: strings are markdown, objects are UI blocks. */
  regions: (string | { ui: string; terminated: boolean })[];
  /** The last reported markdown tail. */
  tail: string;
}

function record(): { rec: Recording; write(chunk: string): void; end(): void } {
  const rec: Recording = { regions: [""], tail: "" };
  const last = (): string | { ui: string; terminated: boolean } => rec.regions.at(-1)!;
  const splitter = createFenceSplitter({
    markdown(text) {
      const current = last();
      if (typeof current !== "string") throw new Error("markdown() while a UI block is open");
      rec.regions[rec.regions.length - 1] = current + text;
    },
    markdownTail(tail) {
      rec.tail = tail;
    },
    openUi() {
      rec.regions.push({ ui: "", terminated: false });
    },
    ui(text) {
      const current = last();
      if (typeof current === "string") throw new Error("ui() while no UI block is open");
      current.ui += text;
    },
    closeUi(terminated) {
      const current = last();
      if (typeof current === "string") throw new Error("closeUi() while no UI block is open");
      current.terminated = terminated;
      rec.regions.push("");
    },
  });
  return { rec, write: splitter.write, end: splitter.end };
}

/** Run the whole input through in the given chunk sizes and return the recording. */
function run(input: string, sizes?: number[]): Recording {
  const r = record();
  if (sizes === undefined) {
    r.write(input);
  } else {
    let offset = 0;
    for (const size of sizes) {
      r.write(input.slice(offset, offset + size));
      offset += size;
    }
    r.write(input.slice(offset));
  }
  r.end();
  return r.rec;
}

const DOC = `Hello *world*.

\`\`\`ui+jsx
<div title="x">hi</div>
\`\`\`

After.
`;

describe("createFenceSplitter", () => {
  it("passes a fence-less document through as one markdown region", () => {
    const rec = run("# Title\n\nBody text.\n");
    expect(rec.regions).toEqual(["# Title\n\nBody text.\n"]);
  });

  it("extracts a ui+jsx fence into a UI region", () => {
    const rec = run(DOC);
    expect(rec.regions).toEqual([
      "Hello *world*.\n\n",
      { ui: '<div title="x">hi</div>\n', terminated: true },
      "\nAfter.\n",
    ]);
  });

  it("is chunking-invariant in its committed regions", () => {
    const whole = run(DOC);
    const oneByOne = run(
      DOC,
      Array.from({ length: DOC.length }, () => 1),
    );
    expect(oneByOne.regions).toEqual(whole.regions);
    for (const sizes of [
      [3, 1, 7, 2],
      [10, 30],
      [1, 50, 1],
    ]) {
      expect(run(DOC, sizes).regions).toEqual(whole.regions);
    }
  });

  it("reports a partial line as the markdown tail, then commits it on newline", () => {
    const r = record();
    r.write("Hello wo");
    expect(r.rec.regions).toEqual([""]);
    expect(r.rec.tail).toBe("Hello wo");
    r.write("rld\n");
    expect(r.rec.regions).toEqual(["Hello world\n"]);
    expect(r.rec.tail).toBe("");
  });

  it("withholds a tail that could still become a ui+jsx opener", () => {
    const r = record();
    r.write("```ui+j");
    expect(r.rec.tail).toBe("");
    r.write("sx");
    expect(r.rec.tail).toBe("");
    // Turns out not to be a ui+jsx fence after all.
    r.write("!and more\n");
    expect(r.rec.regions).toEqual(["```ui+jsx!and more\n"]);
  });

  it("does not withhold a tail that can no longer be a fence", () => {
    const r = record();
    r.write("`code` in ");
    expect(r.rec.tail).toBe("`code` in ");
  });

  it("streams UI content within a line once it cannot be a closing fence", () => {
    const r = record();
    r.write("```ui+jsx\n<div>a");
    expect(r.rec.regions[1]).toEqual({ ui: "<div>a", terminated: false });
    r.write("b");
    expect(r.rec.regions[1]).toEqual({ ui: "<div>ab", terminated: false });
    r.write("</div>\n```\n");
    expect(r.rec.regions[1]).toEqual({ ui: "<div>ab</div>\n", terminated: true });
  });

  it("withholds backticks inside a UI block until they resolve", () => {
    const r = record();
    r.write("```ui+jsx\n<div/>\n``");
    expect((r.rec.regions[1] as { ui: string }).ui).toBe("<div/>\n");
    // A third backtick would close; a different character flushes instead.
    r.write("`x\n```\n");
    expect(r.rec.regions[1]).toEqual({ ui: "<div/>\n```x\n", terminated: true });
  });

  it("ignores a ui+jsx opener inside a regular fenced code block", () => {
    const input = "```md\n```ui+jsx\n<div/>\n```\n\nreal text\n";
    const rec = run(input);
    expect(rec.regions).toEqual([input]);
  });

  it("requires the closing fence to be at least as long as the opener", () => {
    const rec = run("````ui+jsx\n<div>\n```\n</div>\n````\nafter\n");
    expect(rec.regions).toEqual(["", { ui: "<div>\n```\n</div>\n", terminated: true }, "after\n"]);
  });

  it("accepts a longer closing fence and an indented opener", () => {
    const rec = run("  ```ui+jsx\n<div/>\n`````\n");
    expect(rec.regions).toEqual(["", { ui: "<div/>\n", terminated: true }, ""]);
  });

  it("reports an unterminated UI block at end of stream", () => {
    const rec = run("before\n```ui+jsx\n<div>hi</div>\n");
    expect(rec.regions).toEqual(["before\n", { ui: "<div>hi</div>\n", terminated: false }, ""]);
  });

  it("closes on a final fence line without a trailing newline", () => {
    const rec = run("```ui+jsx\n<div/>\n```");
    expect(rec.regions).toEqual(["", { ui: "<div/>\n", terminated: true }, ""]);
  });

  it("commits a final markdown line without a trailing newline", () => {
    const rec = run("last line");
    expect(rec.regions).toEqual(["last line"]);
  });

  it("does not treat an indented (4+ spaces) backtick line as a fence", () => {
    const rec = run("    ```ui+jsx\ncode\n");
    expect(rec.regions).toEqual(["    ```ui+jsx\ncode\n"]);
  });

  it("handles back-to-back UI blocks", () => {
    const rec = run("```ui+jsx\n<a/>\n```\n```ui+jsx\n<b/>\n```\n");
    expect(rec.regions).toEqual([
      "",
      { ui: "<a/>\n", terminated: true },
      "",
      { ui: "<b/>\n", terminated: true },
      "",
    ]);
  });

  it("allows blanks around the info string", () => {
    const rec = run("``` ui+jsx \n<div/>\n```\n");
    expect(rec.regions).toEqual(["", { ui: "<div/>\n", terminated: true }, ""]);
  });
});
