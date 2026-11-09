import { describe, expect, it } from "vitest";
import { Bm25Index, tokenize } from "../src/bm25.js";
import { slugify, splitMarkdown } from "../src/corpus.js";

const sample = [
  "# Query Parameters { #query-parameters }",
  "Intro about query params.",
  "## Defaults { #defaults }",
  "Default values for skip and limit.",
  "```python",
  "# not a heading",
  "```",
  "## Optional parameters",
  "Use None as the default to make it optional.",
].join("\n");

describe("splitMarkdown", () => {
  const sections = splitMarkdown("query-params.md", sample);

  it("splits on headings and keeps explicit anchors", () => {
    expect(sections.map((s) => s.id)).toEqual([
      "query-params.md#query-parameters",
      "query-params.md#defaults",
      "query-params.md#optional-parameters",
    ]);
  });

  it("ignores headings inside fenced code", () => {
    expect(sections[1].text).toContain("# not a heading");
  });

  it("tracks the heading path", () => {
    expect(sections[2].headingPath).toEqual(["Query Parameters", "Optional parameters"]);
  });

  it("slugifies titles without explicit anchors", () => {
    expect(slugify("Optional  Parameters!")).toBe("optional-parameters");
  });
});

describe("Bm25Index", () => {
  const index = new Bm25Index(splitMarkdown("query-params.md", sample));

  it("drops stopwords and short tokens", () => {
    expect(tokenize("How do I set the default?")).toEqual(["set", "default"]);
  });

  it("ranks the most relevant section first", () => {
    const [top] = index.search("optional None default");
    expect(top.section.anchor).toBe("optional-parameters");
  });

  it("returns nothing for out-of-vocabulary queries", () => {
    expect(index.search("kubernetes helm")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(index.search("default", 1)).toHaveLength(1);
  });
});
