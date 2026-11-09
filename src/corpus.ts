import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export interface Section {
  id: string;
  file: string;
  anchor: string;
  title: string;
  headingPath: string[];
  text: string;
}

export interface DocumentInfo {
  file: string;
  title: string;
  sections: number;
}

export interface Corpus {
  sections: Section[];
  documents: DocumentInfo[];
}

const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*(?:\{\s*#([\w-]+)\s*\})?\s*$/;
const FENCE = /^\s*(```|~~~)/;

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function splitMarkdown(file: string, markdown: string): Section[] {
  const sections: Section[] = [];
  const stack: string[] = [];
  let current: { title: string; anchor: string; path: string[]; lines: string[] } | null = null;
  let fence: string | null = null;

  const flush = (): void => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    if (text.length > 0 || sections.length === 0) {
      sections.push({
        id: `${file}#${current.anchor}`,
        file,
        anchor: current.anchor,
        title: current.title,
        headingPath: current.path,
        text,
      });
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const marker = FENCE.exec(line)?.[1];
    if (marker && (fence === null || fence === marker)) fence = fence === null ? marker : null;
    const match = fence !== null || marker ? null : HEADING.exec(line);
    if (match) {
      flush();
      const level = match[1].length;
      const title = match[2];
      stack.length = level - 1;
      stack[level - 1] = title;
      current = {
        title,
        anchor: match[3] ?? slugify(title),
        path: stack.filter((part): part is string => typeof part === "string"),
        lines: [],
      };
      continue;
    }
    if (!current) current = { title: file, anchor: "top", path: [file], lines: [] };
    current.lines.push(line);
  }
  flush();
  return sections;
}

async function listMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

export async function loadCorpus(dir: string): Promise<Corpus> {
  const sections: Section[] = [];
  const documents: DocumentInfo[] = [];
  for (const path of await listMarkdown(dir)) {
    const file = relative(dir, path).split(sep).join("/");
    const parsed = splitMarkdown(file, await readFile(path, "utf8"));
    sections.push(...parsed);
    documents.push({ file, title: parsed[0]?.title ?? file, sections: parsed.length });
  }
  return { sections, documents };
}
