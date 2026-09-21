import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./markdown";

function html(source: string): string {
  return renderToStaticMarkup(<>{renderMarkdown(source)}</>);
}

describe("renderMarkdown — blocks", () => {
  it("renders paragraphs separated by blank lines", () => {
    expect(html("one\n\ntwo\n")).toBe("<p>one</p><p>two</p>");
  });

  it("joins consecutive paragraph lines with a space", () => {
    expect(html("line one\nline two\n")).toBe("<p>line one line two</p>");
  });

  it("renders ATX headings of every level", () => {
    expect(html("# a\n###### b\n")).toBe("<h1>a</h1><h6>b</h6>");
  });

  it("strips closing hashes from a heading", () => {
    expect(html("## title ##\n")).toBe("<h2>title</h2>");
  });

  it("renders thematic breaks", () => {
    expect(html("a\n\n---\n\nb\n")).toBe("<p>a</p><hr/><p>b</p>");
  });

  it("renders an unordered list", () => {
    expect(html("- a\n- b\n")).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  it("renders an ordered list", () => {
    expect(html("1. a\n2. b\n")).toBe("<ol><li>a</li><li>b</li></ol>");
  });

  it("nests an indented list inside its parent item", () => {
    expect(html("- a\n  - b\n- c\n")).toBe("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
  });

  it("renders a blockquote with inner blocks", () => {
    expect(html("> quoted\n> line\n")).toBe("<blockquote><p>quoted line</p></blockquote>");
  });

  it("renders a fenced code block with its language", () => {
    expect(html("```js\nconst a = 1;\n```\n")).toBe(
      '<pre><code class="language-js">const a = 1;\n</code></pre>',
    );
  });

  it("renders an unterminated fence to the end (streaming-friendly)", () => {
    expect(html("```\npartial")).toBe("<pre><code>partial\n</code></pre>");
  });

  it("keeps markdown syntax literal inside a fence", () => {
    expect(html("```\n# not a heading\n```\n")).toBe("<pre><code># not a heading\n</code></pre>");
  });

  it("renders a hard line break from a trailing double space", () => {
    expect(html("a  \nb\n")).toBe("<p>a<br/>b</p>");
  });

  it("renders a hard line break from a trailing backslash", () => {
    expect(html("a\\\nb\n")).toBe("<p>a<br/>b</p>");
  });

  it("renders the empty string as nothing", () => {
    expect(html("")).toBe("");
  });
});

describe("renderMarkdown — inline", () => {
  it("renders strong and emphasis", () => {
    expect(html("**bold** and *italic* and __also__ and _this_\n")).toBe(
      "<p><strong>bold</strong> and <em>italic</em> and <strong>also</strong> and <em>this</em></p>",
    );
  });

  it("nests inline markup", () => {
    expect(html("**bold *inner***\n")).toBe("<p><strong>bold <em>inner</em></strong></p>");
  });

  it("renders code spans, preserving inner markup literally", () => {
    expect(html("`a *b* c`\n")).toBe("<p><code>a *b* c</code></p>");
  });

  it("supports double-backtick code spans containing a backtick", () => {
    expect(html("`` a`b ``\n")).toBe("<p><code>a`b</code></p>");
  });

  it("renders links", () => {
    expect(html("[text](https://example.com)\n")).toBe(
      '<p><a href="https://example.com">text</a></p>',
    );
  });

  it("renders images", () => {
    // React 19's static renderer also emits a <link rel="preload"> for the
    // image; assert on the markup we produce.
    expect(html("![alt](https://example.com/a.png)\n")).toContain(
      '<p><img src="https://example.com/a.png" alt="alt"/></p>',
    );
  });

  it("keeps unmatched markers literal", () => {
    expect(html("2 * 3 and a_b and `tick\n")).toBe("<p>2 * 3 and a_b and `tick</p>");
  });

  it("honors backslash escapes", () => {
    expect(html("\\*not em\\*\n")).toBe("<p>*not em*</p>");
  });
});

describe("renderMarkdown — safety", () => {
  it("renders raw HTML as literal text", () => {
    expect(html('<script>alert("x")</script>\n')).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
    );
  });

  it("drops javascript: links, keeping the label", () => {
    expect(html("[click](javascript:alert(1))\n")).toBe("<p>click</p>");
  });

  it("drops links whose scheme hides behind control characters", () => {
    expect(html("[click](java\u0000script:alert(1))\n")).toBe("<p>click</p>");
  });

  it("drops data: images, keeping the alt text", () => {
    expect(html("![x](data:text/html,foo)\n")).toBe("<p>x</p>");
  });

  it("allows relative and mailto links", () => {
    expect(html("[a](/path) [b](mailto:x@example.com)\n")).toBe(
      '<p><a href="/path">a</a> <a href="mailto:x@example.com">b</a></p>',
    );
  });
});
