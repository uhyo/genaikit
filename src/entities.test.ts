import { describe, expect, it } from "vitest";

import { decodeEntities, decodeEntity } from "./entities";

describe("decodeEntity", () => {
  it("decodes the XML/basic named entities", () => {
    expect(decodeEntity("amp")).toBe("&");
    expect(decodeEntity("lt")).toBe("<");
    expect(decodeEntity("gt")).toBe(">");
    expect(decodeEntity("quot")).toBe('"');
    expect(decodeEntity("apos")).toBe("'");
  });

  it("decodes entities from every named range", () => {
    expect(decodeEntity("nbsp")).toBe(" "); // Latin-1 start
    expect(decodeEntity("copy")).toBe("©");
    expect(decodeEntity("eacute")).toBe("é");
    expect(decodeEntity("yuml")).toBe("ÿ"); // Latin-1 end (U+00FF)
    expect(decodeEntity("Rho")).toBe("Ρ"); // before the U+03A2 gap
    expect(decodeEntity("Sigma")).toBe("Σ"); // after the gap
    expect(decodeEntity("sigmaf")).toBe("ς"); // final sigma (U+03C2)
    expect(decodeEntity("omega")).toBe("ω");
    expect(decodeEntity("hellip")).toBe("…");
    expect(decodeEntity("mdash")).toBe("—");
    expect(decodeEntity("euro")).toBe("€");
    expect(decodeEntity("rarr")).toBe("→");
    expect(decodeEntity("hearts")).toBe("♥");
    expect(decodeEntity("lang")).toBe("⟨");
  });

  it("is case-sensitive like real entity names", () => {
    expect(decodeEntity("AMP")).toBeNull();
    expect(decodeEntity("Omega")).toBe("Ω");
    expect(decodeEntity("omega")).toBe("ω");
  });

  it("decodes decimal and hex numeric references", () => {
    expect(decodeEntity("#65")).toBe("A");
    expect(decodeEntity("#00065")).toBe("A"); // leading zeros are fine
    expect(decodeEntity("#x41")).toBe("A");
    expect(decodeEntity("#x1F600")).toBe("😀");
    expect(decodeEntity("#x10FFFF")).toBe("\u{10FFFF}");
  });

  it("rejects malformed or out-of-range numeric references", () => {
    expect(decodeEntity("#")).toBeNull();
    expect(decodeEntity("#x")).toBeNull();
    expect(decodeEntity("#xZZ")).toBeNull();
    expect(decodeEntity("#1a")).toBeNull(); // hex digits need the x prefix
    expect(decodeEntity("#X41")).toBeNull(); // hex marker is lowercase-only, like Babel
    expect(decodeEntity("#x110000")).toBeNull(); // beyond Unicode
    // Deliberately stricter than Babel: no NUL / lone surrogates in output.
    expect(decodeEntity("#0")).toBeNull();
    expect(decodeEntity("#xD800")).toBeNull();
  });

  it("rejects unknown names and the empty body", () => {
    expect(decodeEntity("bogus")).toBeNull();
    expect(decodeEntity("")).toBeNull();
  });
});

describe("decodeEntities", () => {
  it("decodes every valid reference in a string", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#33;")).toBe("a & b <c> !");
  });

  it("keeps invalid or unterminated references verbatim", () => {
    expect(decodeEntities("&nope; &#; &#xZZ; & &amp")).toBe("&nope; &#; &#xZZ; & &amp");
  });

  it("returns entity-free strings unchanged", () => {
    const s = "no entities here";
    expect(decodeEntities(s)).toBe(s);
  });
});
