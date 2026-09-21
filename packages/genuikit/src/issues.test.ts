import { describe, expect, it } from "vitest";

import type { JsxErrorEvent } from "jsx-incremental-parser";

import type { GenUiIssue } from "./issues";
import { formatIssueReport } from "./issues";

const jsxEvent: JsxErrorEvent = {
  kind: "unknown-component",
  tag: "Nope",
  message: "Unknown component <Nope>",
  location: { line: 1, column: 1, offset: 0, lineText: "<Nope />" },
};

describe("formatIssueReport", () => {
  it("returns null when there is nothing to report", () => {
    expect(formatIssueReport([])).toBeNull();
  });

  it("groups issues by block, in document order", () => {
    const issues: GenUiIssue[] = [
      { kind: "unclosed-fence", blockIndex: 1 },
      { kind: "jsx-error", blockIndex: 0, event: jsxEvent },
      { kind: "render-error", blockIndex: 0, error: new Error("boom") },
    ];
    const report = formatIssueReport(issues)!;
    expect(report).toContain("problems in its `ui+jsx` blocks");
    const block1 = report.indexOf("In `ui+jsx` block 1:");
    const block2 = report.indexOf("In `ui+jsx` block 2:");
    expect(block1).toBeGreaterThan(-1);
    expect(block2).toBeGreaterThan(block1);
    expect(report).toContain("- Unknown component <Nope> (line 1, column 1)");
    expect(report).toContain("- Rendering crashed: boom");
    expect(report).toContain("The block was hidden from the user.");
    expect(report).toContain("- The ```ui+jsx code fence was never closed");
  });

  it("indents multi-line issue details under their bullet", () => {
    const report = formatIssueReport([{ kind: "jsx-error", blockIndex: 0, event: jsxEvent }])!;
    // formatJsxError produces a code frame below the message line.
    expect(report).toMatch(/- Unknown component <Nope> \(line 1, column 1\)\n\n {2}/);
  });

  it("stringifies non-Error render crashes", () => {
    const report = formatIssueReport([
      { kind: "render-error", blockIndex: 0, error: "string throw" },
    ])!;
    expect(report).toContain("Rendering crashed: string throw");
  });
});
