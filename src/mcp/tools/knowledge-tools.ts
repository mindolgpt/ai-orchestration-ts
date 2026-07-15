import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SemanticSearch } from "@/knowledge/search";
import { ObsidianVault } from "@/knowledge/vault";

export function registerKnowledgeTools(
  server: McpServer,
  search: SemanticSearch,
  vault: ObsidianVault
): void {
  server.registerTool("recall_knowledge", {
    description: "Semantic search knowledge base",
    inputSchema: z.object({ query: z.string(), top_k: z.number().optional() }),
  }, async (args) => {
    await search.load();
    const results = await search.search(args.query, args.top_k ?? 5);
    return { content: [{ type: "text" as const, text: JSON.stringify({ results }) }] };
  });

  server.registerTool("store_knowledge", {
    description: "Save to Obsidian vault",
    inputSchema: z.object({ path: z.string(), content: z.string(), tags: z.array(z.string()).optional(), links: z.array(z.string()).optional() }),
  }, async (args) => {
    await vault.initialize();
    const full = await vault.writeNote(args.path, args.content, args.tags, args.links);
    await search.addDocument(args.path, args.path.split("/").pop() || args.path, args.content, args.tags);
    await search.save();
    return { content: [{ type: "text" as const, text: JSON.stringify({ path: full, title: args.path.split("/").pop(), tags: args.tags || [] }) }] };
  });
}
