import { createElement, Fragment } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GenUiIssue } from "./issues";
import type { GenUiMessageOptions } from "./message";
import { createGenUiMessage } from "./message";

// Seeded generator of streamed genuikit messages (markdown + ui+jsx fences,
// valid and invalid), checking the package-level counterpart of the parser's
// chunk-independence property: the final rendered result — and the collected
// issues — must not depend on how the stream is split into chunks.

function makeRng(seed: number): () => number {
  let s = seed % 0x7fffffff;
  if (s <= 0) s += 0x7ffffffe;
  return () => {
    s = (s * 48271) % 0x7fffffff;
    return (s - 1) / 0x7ffffffe;
  };
}

type Rng = () => number;

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

const WORDS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta*", "`eta`", "**theta**"];

function genLine(rng: Rng): string {
  const n = 1 + Math.floor(rng() * 5);
  const words: string[] = [];
  for (let i = 0; i < n; i++) words.push(pick(rng, WORDS));
  return words.join(" ");
}

function genMarkdownBlock(rng: Rng): string {
  const r = rng();
  if (r < 0.2) return `# ${genLine(rng)}\n`;
  if (r < 0.3) return `- ${genLine(rng)}\n- ${genLine(rng)}\n`;
  if (r < 0.4) return `> ${genLine(rng)}\n`;
  if (r < 0.5) return "```js\nconst x = 1; // ```ui+jsx inside a code fence\n```\n";
  return `${genLine(rng)}\n${genLine(rng)}\n`;
}

const JSX_SNIPPETS = [
  '<div title="x">hello</div>',
  "<Card label={user.name}>inner text</Card>",
  "<button onClick={actions.submit}>Go</button>",
  "<button onClick={actions.launchRocket}>Fire</button>", // model-defined (dynamic) action
  "<Unknown />", // unknown-component issue
  "<div>{compute()}</div>", // unsupported-expression issue
  "<div><span>mismatch</b></div>", // mismatched-tag issue
  "<div>unclosed", // unclosed-tag issue
  "<ul><li>a</li><li>{count}</li></ul>",
];

function genUiBlock(rng: Rng): string {
  const body = pick(rng, JSX_SNIPPETS);
  return `\`\`\`ui+jsx\n${body}\n\`\`\`\n`;
}

function genDocument(rng: Rng): string {
  const blocks = 1 + Math.floor(rng() * 5);
  let out = "";
  for (let i = 0; i < blocks; i++) {
    out += rng() < 0.4 ? genUiBlock(rng) : genMarkdownBlock(rng);
    if (rng() < 0.7) out += "\n";
  }
  return out;
}

function randomSplits(rng: Rng, length: number): number[] {
  const sizes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    const take = 1 + Math.floor(rng() * Math.min(7, remaining));
    sizes.push(take);
    remaining -= take;
  }
  return sizes;
}

async function* chunked(input: string, sizes: number[]): AsyncGenerator<string> {
  let offset = 0;
  for (const size of sizes) {
    yield input.slice(offset, offset + size);
    offset += size;
  }
  if (offset < input.length) yield input.slice(offset);
}

const OPTIONS: GenUiMessageOptions = {
  components: {
    Card: ({ label, children }: { label?: string; children?: ReactNode }) =>
      createElement("section", { "data-label": label }, children),
  },
  variables: { user: { name: "uhyo" }, count: 42 },
  actions: { submit: true },
  dynamicActions: true,
};

/** A chunking-independent fingerprint of an issue. */
function issueKey(issue: GenUiIssue): string {
  switch (issue.kind) {
    case "jsx-error":
      return `${issue.blockIndex}:${issue.event.kind}:${issue.event.message}`;
    default:
      return `${issue.blockIndex}:${issue.kind}`;
  }
}

async function run(input: string, sizes: number[]): Promise<{ html: string; issues: string[] }> {
  const message = createGenUiMessage(chunked(input, sizes), OPTIONS);
  await message.done;
  return {
    html: renderToStaticMarkup(createElement(Fragment, null, message.getSnapshot())),
    // Issues from different blocks may interleave differently (each block
    // drains its own channel), so compare them as a sorted multiset.
    issues: message.getIssues().map(issueKey).toSorted(),
  };
}

describe("Fuzz — chunking invariance of the final message", () => {
  it("renders identically regardless of chunk boundaries", async () => {
    for (let trial = 0; trial < 60; trial++) {
      const rng = makeRng(trial * 2654435761 + 7);
      const input = genDocument(rng);
      // oxlint-disable-next-line no-await-in-loop
      const whole = await run(input, [input.length]);

      // 1-char chunks.
      // oxlint-disable-next-line no-await-in-loop
      const single = await run(
        input,
        Array.from({ length: input.length }, () => 1),
      );
      expect(single, input).toEqual(whole);

      // Random splits.
      for (let k = 0; k < 3; k++) {
        // oxlint-disable-next-line no-await-in-loop
        const random = await run(input, randomSplits(rng, input.length));
        expect(random, input).toEqual(whole);
      }
    }
  }, 30_000);
});
