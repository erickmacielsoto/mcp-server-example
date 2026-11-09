import type { Section } from "./corpus.js";

const STOPWORDS = new Set(
  "a an and are as at be by can do does for from how i if in is it of on or that the this to what when where which with you your".split(" "),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter(
    (token) => token.length > 1 && !STOPWORDS.has(token),
  );
}

export interface SearchHit {
  section: Section;
  score: number;
}

export interface Bm25Options {
  k1?: number;
  b?: number;
  titleBoost?: number;
}

export class Bm25Index {
  private readonly docs: Map<string, number>[] = [];
  private readonly lengths: number[] = [];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;
  private readonly k1: number;
  private readonly b: number;

  constructor(
    private readonly sections: readonly Section[],
    options: Bm25Options = {},
  ) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
    const titleBoost = options.titleBoost ?? 2;
    for (const section of sections) {
      const heading = tokenize(section.headingPath.join(" "));
      const tokens = [...tokenize(section.text), ...Array<string[]>(titleBoost).fill(heading).flat()];
      const tf = new Map<string, number>();
      for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
      for (const token of tf.keys()) this.df.set(token, (this.df.get(token) ?? 0) + 1);
      this.docs.push(tf);
      this.lengths.push(tokens.length);
    }
    const total = this.lengths.reduce((sum, length) => sum + length, 0);
    this.avgLength = sections.length > 0 ? total / sections.length : 0;
  }

  get size(): number {
    return this.sections.length;
  }

  private idf(token: string): number {
    const n = this.df.get(token) ?? 0;
    return Math.log(1 + (this.sections.length - n + 0.5) / (n + 0.5));
  }

  search(query: string, limit = 5): SearchHit[] {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];
    const hits: SearchHit[] = [];
    this.docs.forEach((tf, i) => {
      let score = 0;
      for (const term of terms) {
        const freq = tf.get(term);
        if (!freq) continue;
        const norm = this.k1 * (1 - this.b + (this.b * this.lengths[i]) / this.avgLength);
        score += this.idf(term) * ((freq * (this.k1 + 1)) / (freq + norm));
      }
      if (score > 0) hits.push({ section: this.sections[i], score });
    });
    return hits.sort((x, y) => y.score - x.score).slice(0, limit);
  }
}
