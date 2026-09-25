import { describe, expect, it } from "vitest";

import { FENCE_OPEN, isFenceClose } from "./fence";

describe("FENCE_OPEN", () => {
  it("captures the backtick run and the info string", () => {
    expect(FENCE_OPEN.exec("```js")?.slice(1)).toEqual(["```", "js"]);
    expect(FENCE_OPEN.exec("   ````")?.slice(1)).toEqual(["````", ""]);
  });

  it("rejects deep indentation, short runs, and backticks in the info string", () => {
    expect(FENCE_OPEN.test("    ```")).toBe(false);
    expect(FENCE_OPEN.test("``js")).toBe(false);
    expect(FENCE_OPEN.test("```js`")).toBe(false);
  });
});

describe("isFenceClose", () => {
  it("accepts a run at least as long as the opener, with trailing blanks", () => {
    expect(isFenceClose("```", 3)).toBe(true);
    expect(isFenceClose("  ````  ", 3)).toBe(true);
  });

  it("rejects a shorter run, an info string, or deep indentation", () => {
    expect(isFenceClose("```", 4)).toBe(false);
    expect(isFenceClose("```js", 3)).toBe(false);
    expect(isFenceClose("    ```", 3)).toBe(false);
  });
});
