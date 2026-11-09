#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCorpus } from "./corpus.js";
import { createServer } from "./server.js";

const defaultDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "corpus");

async function main(): Promise<void> {
  const dir = resolve(process.argv[2] ?? process.env.DOCS_DIR ?? defaultDir);
  const corpus = await loadCorpus(dir);
  const server = createServer(corpus);
  await server.connect(new StdioServerTransport());
  console.error(`docs-search: ${corpus.documents.length} documents, ${corpus.sections.length} sections from ${dir}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
