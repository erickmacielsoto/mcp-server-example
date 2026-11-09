import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { loadCorpus } from "../src/corpus.js";
import { createServer } from "../src/server.js";

const corpusDir = resolve(import.meta.dirname, "..", "corpus");
const clients: Client[] = [];

async function connect(withSampling = false): Promise<Client> {
  const server = createServer(await loadCorpus(corpusDir));
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: withSampling ? { sampling: {} } : {} },
  );
  if (withSampling) {
    client.setRequestHandler(CreateMessageRequestSchema, (request) => {
      const content = request.params.messages[0].content;
      const parts = Array.isArray(content) ? content : [content];
      const grounded = parts.some((part) => part.type === "text" && part.text.includes("[1]"));
      const text = grounded ? "Use Query() [1]." : "no context";
      return { role: "assistant", model: "stub", content: { type: "text", text } };
    });
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("docs-search MCP server", () => {
  it("exposes four tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "answer_question",
      "list_documents",
      "read_section",
      "search_docs",
    ]);
  });

  it("lists the bundled documents", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "list_documents", arguments: {} });
    const docs = (res.structuredContent as { documents: { file: string }[] }).documents;
    expect(docs.map((d) => d.file)).toContain("fastapi/query-params.md");
  });

  it("finds the CORS section for a CORS question", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "search_docs",
      arguments: { query: "allow cross-origin requests from a frontend", limit: 3 },
    });
    const hits = (res.structuredContent as { hits: { file: string }[] }).hits;
    expect(hits[0].file).toBe("fastapi/cors.md");
  });

  it("rejects invalid input through zod", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "search_docs", arguments: { query: "", limit: 99 } });
    expect(res.isError).toBe(true);
  });

  it("reads a section by id and reports unknown ids", async () => {
    const client = await connect();
    const ok = await client.callTool({ name: "read_section", arguments: { id: "fastapi/query-params.md#defaults" } });
    expect((ok.structuredContent as { section: string }).section).toBe("Query Parameters > Defaults");
    const missing = await client.callTool({ name: "read_section", arguments: { id: "fastapi/nope.md#x" } });
    expect(missing.isError).toBe(true);
  });

  it("returns grounded context when the client cannot sample", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "answer_question",
      arguments: { question: "How do I declare an optional query parameter?" },
    });
    const out = res.structuredContent as { mode: string; citations: { id: string }[]; context: string };
    expect(out.mode).toBe("context_only");
    expect(out.citations.length).toBeGreaterThan(0);
    expect(out.context).toContain("[1]");
  });

  it("uses MCP sampling when the client supports it", async () => {
    const client = await connect(true);
    const res = await client.callTool({
      name: "answer_question",
      arguments: { question: "How do I declare an optional query parameter?", k: 2 },
    });
    const out = res.structuredContent as { mode: string; answer: string; citations: unknown[] };
    expect(out.mode).toBe("sampled");
    expect(out.answer).toBe("Use Query() [1].");
    expect(out.citations).toHaveLength(2);
  });
});
