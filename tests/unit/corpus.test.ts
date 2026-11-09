import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCorpus, splitMarkdown } from "../../src/corpus.js";

describe("splitMarkdown edge cases", () => {
  it("strips optional closing hashes from ATX headings", () => {
    const [section] = splitMarkdown("a.md", "## Install ##\nbody");
    expect(section.title).toBe("Install");
    expect(section.anchor).toBe("install");
  });

  it("treats ~~~ fences like ``` fences", () => {
    const sections = splitMarkdown("a.md", "# A\n~~~bash\n# not a heading\n~~~\n");
    expect(sections).toHaveLength(1);
    expect(sections[0].text).toContain("# not a heading");
  });
});

describe("loadCorpus", () => {
  it("indexes nested markdown files only, with posix relative paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "corpus-"));
    await mkdir(join(dir, "guide"));
    await writeFile(join(dir, "guide", "intro.md"), "# Intro\ntext");
    await writeFile(join(dir, "notes.txt"), "# Ignored\ntext");
    const corpus = await loadCorpus(dir);
    expect(corpus.documents).toEqual([{ file: "guide/intro.md", title: "Intro", sections: 1 }]);
  });
});
