import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ObsidianVault } from "@/knowledge/vault";
import { SemanticSearch } from "@/knowledge/search";
import {
  fileBack,
  getWikiSchema,
  ingestRaw,
  ingestSource,
  lintWiki,
  queryWiki,
  updateWikiPage,
} from "@/knowledge/wiki-ops";

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function registerWikiTools(
  server: McpServer,
  vault: ObsidianVault,
  search: SemanticSearch
): void {
  server.registerTool(
    "get_wiki_schema",
    {
      description:
        "Read the vault wiki schema (AGENTS.md). Call this first when maintaining the wiki so you act as a disciplined wiki maintainer, not a generic chatbot.",
    },
    async () => jsonResult(await getWikiSchema(vault))
  );

  server.registerTool(
    "ingest_raw",
    {
      description:
        "Store an immutable original document under vault/raw/. Never modify raw later. Prefer this before ingest_source for durable knowledge.",
      inputSchema: z.object({
        title: z.string(),
        content: z.string(),
        source_uri: z.string().optional(),
        id: z.string().optional(),
      }),
    },
    async (args) => {
      try {
        return jsonResult(await ingestRaw(vault, args));
      } catch (err) {
        return jsonResult({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  server.registerTool(
    "ingest_source",
    {
      description:
        "Create/update ONE wiki concept page. Workflow: (1) get_wiki_schema (2) ingest_raw for originals (3) ingest_source per concept (4) update_wiki_page for related entities (5) confirm index.md + log.md. Do not put multiple concepts in one call.",
      inputSchema: z.object({
        title: z.string(),
        content: z.string(),
        tags: z.array(z.string()).optional(),
        raw_id: z.string().optional(),
        source_path: z.string().optional(),
        summary: z.string().optional(),
      }),
    },
    async (args) => jsonResult(await ingestSource(vault, search, args))
  );

  server.registerTool(
    "update_wiki_page",
    {
      description:
        "Update an existing wiki page (cross-link fixes, superseded claims). Refuses raw/. Use after ingest when related entity/concept pages need changes.",
      inputSchema: z.object({
        title: z.string(),
        content: z.string(),
        tags: z.array(z.string()).optional(),
        summary: z.string().optional(),
      }),
    },
    async (args) => {
      try {
        return jsonResult(await updateWikiPage(vault, search, args));
      } catch (err) {
        return jsonResult({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  server.registerTool(
    "query_wiki",
    {
      description:
        "Search wiki pages and return full content + citations. Synthesize answers with citations. If the answer is durable, follow up with file_back.",
      inputSchema: z.object({
        query: z.string(),
        top_k: z.number().optional(),
      }),
    },
    async (args) => jsonResult(await queryWiki(vault, search, args.query, args.top_k ?? 5))
  );

  server.registerTool(
    "file_back",
    {
      description:
        "Write a durable query synthesis back into the wiki (with optional citations). Updates index.md and appends log.md.",
      inputSchema: z.object({
        title: z.string(),
        content: z.string(),
        tags: z.array(z.string()).optional(),
        citations: z.array(z.string()).optional(),
        query: z.string().optional(),
      }),
    },
    async (args) => jsonResult(await fileBack(vault, search, args))
  );

  server.registerTool(
    "lint_wiki",
    {
      description:
        "Wiki health check. deep=true adds broken links, stubs, stale pages, deprecated-still-linked. CI: `aio wiki-lint --fail`.",
      inputSchema: z.object({
        deep: z.boolean().optional(),
        stale_days: z.number().optional(),
      }),
    },
    async (args) =>
      jsonResult(await lintWiki(vault, { deep: args.deep === true, staleDays: args.stale_days }))
  );
}
