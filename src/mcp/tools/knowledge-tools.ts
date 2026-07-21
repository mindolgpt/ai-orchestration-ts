import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { SemanticSearch } from '@/knowledge/search'
import { ObsidianVault } from '@/knowledge/vault'
import { queryWiki } from '@/knowledge/wiki-ops'
import { jsonResult } from '@/mcp/json-result'
import { registerMcpTool } from '@/mcp/register-tool'

export function registerKnowledgeTools(
  server: McpServer,
  search: SemanticSearch,
  vault: ObsidianVault
): void {
  registerMcpTool(
    server,
    'recall_knowledge',
    {
      description:
        'Deprecated — use query_wiki (snippets mode). Semantic search returning snippets only.',
      inputSchema: z.object({ query: z.string(), top_k: z.number().optional() }),
    },
    async (args) => {
      const data = await queryWiki(vault, search, args.query, args.top_k ?? 5, {
        response_mode: 'snippets',
      })
      return jsonResult({
        deprecated: true,
        use_instead: 'query_wiki',
        results: data.pages.map((p) => ({
          path: p.path,
          title: p.title,
          score: p.score,
          snippet: p.snippet,
          tags: p.tags,
        })),
      })
    }
  )

  registerMcpTool(
    server,
    'store_knowledge',
    {
      description:
        'Deprecated — bypasses wiki 3-layer workflow. Prefer ingest_pipeline or file_back.',
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
      }),
    },
    async (args) => {
      await vault.initialize()
      const full = await vault.writeNote(args.path, args.content, args.tags, args.links)
      await search.addDocument(
        args.path,
        args.path.split('/').pop() || args.path,
        args.content,
        args.tags
      )
      await search.save()
      return jsonResult({
        deprecated: true,
        use_instead: 'ingest_pipeline or file_back',
        path: full,
        title: args.path.split('/').pop(),
        tags: args.tags || [],
      })
    }
  )
}
