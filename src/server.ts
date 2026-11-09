import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { Bm25Index, type SearchHit } from "./bm25.js";
import type { Corpus, Section } from "./corpus.js";

export const SERVER_NAME = "docs-search";
export const SERVER_VERSION = "0.1.0";

const hitSchema = z.object({
  id: z.string(),
  file: z.string(),
  section: z.string(),
  score: z.number(),
  snippet: z.string(),
});

const citationSchema = z.object({ ref: z.number().int(), id: z.string(), section: z.string() });

export function snippet(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function toHit({ section, score }: SearchHit): z.infer<typeof hitSchema> {
  return {
    id: section.id,
    file: section.file,
    section: section.headingPath.join(" > "),
    score: Number(score.toFixed(4)),
    snippet: snippet(section.text),
  };
}

function result<T extends Record<string, unknown>>(structured: T, text?: string): CallToolResult {
  return {
    content: [{ type: "text", text: text ?? JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

function error(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function buildContext(hits: readonly SearchHit[], maxChars = 1500): string {
  return hits
    .map(({ section }, i) => `[${i + 1}] ${section.id} (${section.headingPath.join(" > ")})\n${section.text.slice(0, maxChars)}`)
    .join("\n\n---\n\n");
}

export function createServer(corpus: Corpus): McpServer {
  const index = new Bm25Index(corpus.sections);
  const byId = new Map<string, Section>(corpus.sections.map((section) => [section.id, section]));
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description: "List every indexed markdown document with its title and number of sections.",
      outputSchema: {
        documents: z.array(z.object({ file: z.string(), title: z.string(), sections: z.number().int() })),
      },
      annotations: { readOnlyHint: true },
    },
    () => result({ documents: corpus.documents }),
  );

  server.registerTool(
    "search_docs",
    {
      title: "Search documentation",
      description: "BM25 keyword search over documentation sections. Returns section ids usable with read_section.",
      inputSchema: {
        query: z.string().trim().min(1).max(500).describe("Natural-language or keyword query"),
        limit: z.number().int().min(1).max(20).default(5).describe("Maximum number of hits"),
      },
      outputSchema: { hits: z.array(hitSchema) },
      annotations: { readOnlyHint: true },
    },
    ({ query, limit }) => result({ hits: index.search(query, limit).map(toHit) }),
  );

  server.registerTool(
    "read_section",
    {
      title: "Read section",
      description: "Return the full text of one section by id, e.g. 'query-params.md#defaults'.",
      inputSchema: { id: z.string().regex(/^[^#]+\.md#[\w-]+$/, "expected '<file>.md#<anchor>'") },
      outputSchema: { id: z.string(), file: z.string(), section: z.string(), text: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) => {
      const section = byId.get(id);
      if (!section) return error(`Unknown section id: ${id}`);
      return result(
        { id, file: section.file, section: section.headingPath.join(" > "), text: section.text },
        section.text,
      );
    },
  );

  server.registerTool(
    "answer_question",
    {
      title: "Answer from documentation (RAG)",
      description:
        "Retrieve the top-k sections for a question and answer with numbered citations. Uses MCP sampling when the client supports it; otherwise returns the grounded context for the caller's model.",
      inputSchema: {
        question: z.string().trim().min(3).max(1000),
        k: z.number().int().min(1).max(8).default(4),
      },
      outputSchema: {
        mode: z.enum(["sampled", "context_only"]),
        answer: z.string().nullable(),
        context: z.string(),
        citations: z.array(citationSchema),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ question, k }) => {
      const hits = index.search(question, k);
      const citations = hits.map(({ section }, i) => ({
        ref: i + 1,
        id: section.id,
        section: section.headingPath.join(" > "),
      }));
      const context = buildContext(hits);
      if (hits.length === 0) {
        return result({ mode: "context_only" as const, answer: null, context: "", citations });
      }
      if (!server.server.getClientCapabilities()?.sampling) {
        return result({ mode: "context_only" as const, answer: null, context, citations });
      }
      const response = await server.server.createMessage({
        systemPrompt:
          "Answer only from the numbered context. Cite sources inline as [n]. If the context is insufficient, say so.",
        messages: [
          { role: "user", content: { type: "text", text: `Context:\n${context}\n\nQuestion: ${question}` } },
        ],
        maxTokens: 600,
      });
      const answer = response.content.type === "text" ? response.content.text : null;
      return result({ mode: "sampled" as const, answer, context, citations }, answer ?? context);
    },
  );

  return server;
}
