import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import {
  fileBack,
  getWikiSchema,
  ingestSource,
  lintWiki,
  queryWiki,
  updateWikiPage,
} from '@/knowledge/wiki-ops'
import {
  ingestPipeline,
  ingestRawFromOpts,
  ingestSourceBatch,
} from '@/knowledge/wiki-ingest-pipeline'
import {
  proposeWikiChange,
  listWikiProposals,
  applyWikiProposal,
  rejectWikiProposal,
  wikiDiff,
} from '@/knowledge/wiki-mr'
import { resolveProjectRoot } from '@/knowledge/paths'
import { jsonResult } from '@/mcp/json-result'
import { registerMcpTool } from '@/mcp/register-tool'
import { jsonErrorResult } from '@/mcp/tool-error'

const conceptSchema = z.object({
  title: z.string(),
  content: z.string().optional(),
  outline: z.string().optional(),
  tags: z.array(z.string()).optional(),
  subdir: z.string().optional(),
  summary: z.string().optional(),
})

export function registerWikiTools(
  server: McpServer,
  vault: ObsidianVault,
  search: SemanticSearch
): void {
  registerMcpTool(
    server,
    'get_wiki_schema',
    {
      description:
        'Wiki schema excerpt (default). Use mode:full or MCP resource aio://wiki/schema for full AGENTS.md.',
      inputSchema: z.object({
        mode: z.enum(['excerpt', 'full']).optional(),
        max_chars: z.number().optional(),
      }),
    },
    async (args) =>
      jsonResult(await getWikiSchema(vault, { mode: args.mode, max_chars: args.max_chars }))
  )

  registerMcpTool(
    server,
    'ingest_raw',
    {
      description:
        'Deprecated — use ingest_pipeline. Stores an immutable original under vault/raw/.',
      inputSchema: z.object({
        title: z.string(),
        content: z.string().optional(),
        file_path: z.string().optional(),
        source_uri: z.string().optional(),
        id: z.string().optional(),
      }),
    },
    async (args) => {
      try {
        const data = await ingestRawFromOpts(vault, {
          ...args,
          content: args.content || '',
          project_root: resolveProjectRoot(),
        })
        return jsonResult({ ...data, deprecated: true, use_instead: 'ingest_pipeline' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return jsonErrorResult(msg, {
          hint: 'ingest_raw requires non-empty content or file_path',
          fix: 'ingest_pipeline({ file_path: "docs/x.md", concepts: [...] })',
        })
      }
    }
  )

  registerMcpTool(
    server,
    'ingest_source',
    {
      description:
        'Deprecated — use ingest_pipeline. Create/update ONE wiki concept page from raw/source.',
      inputSchema: z.object({
        title: z.string(),
        content: z.string(),
        tags: z.array(z.string()).optional(),
        raw_id: z.string().optional(),
        source_path: z.string().optional(),
        summary: z.string().optional(),
        subdir: z.string().optional(),
      }),
    },
    async (args) => {
      const data = await ingestSource(vault, search, args)
      return jsonResult({ ...data, deprecated: true, use_instead: 'ingest_pipeline' })
    }
  )

  registerMcpTool(
    server,
    'ingest_source_batch',
    {
      description:
        'Deprecated — use ingest_pipeline. Batch wiki concept pages from one raw source.',
      inputSchema: z.object({
        concepts: z.array(conceptSchema).min(1),
        raw_id: z.string().optional(),
        source_path: z.string().optional(),
        default_subdir: z.string().optional(),
      }),
    },
    async (args) => {
      const data = await ingestSourceBatch(vault, search, args)
      return jsonResult({ ...data, deprecated: true, use_instead: 'ingest_pipeline' })
    }
  )

  registerMcpTool(
    server,
    'ingest_pipeline',
    {
      description:
        'End-to-end ingest: ingest_raw (content or file_path) → wiki concepts → lint_wiki. ' +
        'For NEW docs pass file_path or substantial content. ' +
        'To re-ingest wiki from an existing raw without duplicating it, pass raw_id (skip_raw implied). ' +
        'Never pass chat/command text as content.',
      inputSchema: z.object({
        title: z.string().optional(),
        content: z.string().optional(),
        file_path: z.string().optional(),
        source_uri: z.string().optional(),
        raw_id: z.string().optional(),
        skip_raw: z.boolean().optional(),
        concepts: z.array(conceptSchema).optional(),
        run_lint: z.boolean().optional(),
        lint_mode: z.enum(['none', 'summary', 'full']).optional(),
        lint_deep: z.boolean().optional(),
      }),
    },
    async (args) => {
      try {
        return jsonResult(
          await ingestPipeline(vault, search, {
            ...args,
            project_root: resolveProjectRoot(),
            lint_mode:
              args.lint_mode ??
              (args.run_lint === false ? 'none' : args.run_lint === true ? 'full' : 'summary'),
          })
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return jsonErrorResult(msg, {
          hint: 'ingest_pipeline needs file_path, raw_id, or substantial content',
          fix: 'ingest_pipeline({ file_path: "docs/x.md", concepts: [{ title, content }] })',
        })
      }
    }
  )

  registerMcpTool(
    server,
    'update_wiki_page',
    {
      description:
        'Update an existing wiki page (cross-link fixes, superseded claims). Refuses raw/. Use after ingest when related entity/concept pages need changes.',
      inputSchema: z.object({
        title: z.string(),
        content: z.string(),
        tags: z.array(z.string()).optional(),
        summary: z.string().optional(),
        subdir: z.string().optional(),
      }),
    },
    async (args) => {
      try {
        return jsonResult(await updateWikiPage(vault, search, args))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return jsonErrorResult(msg, {
          hint: 'update_wiki_page only updates existing wiki pages (not raw/)',
          fix: 'ingest_pipeline or ingest_source to create pages first',
        })
      }
    }
  )

  registerMcpTool(
    server,
    'query_wiki',
    {
      description:
        'Search wiki pages (snippets by default). Use response_mode:full for full page bodies. Prefer over recall_knowledge.',
      inputSchema: z.object({
        query: z.string(),
        top_k: z.number().optional(),
        response_mode: z.enum(['snippets', 'full']).optional(),
      }),
    },
    async (args) =>
      jsonResult(
        await queryWiki(vault, search, args.query, args.top_k ?? 5, {
          response_mode: args.response_mode,
        })
      )
  )

  registerMcpTool(
    server,
    'file_back',
    {
      description:
        'Write a durable query synthesis back into the wiki (with optional citations). Updates index.md and appends log.md.',
      inputSchema: z.object({
        title: z.string(),
        content: z.string(),
        tags: z.array(z.string()).optional(),
        citations: z.array(z.string()).optional(),
        query: z.string().optional(),
        subdir: z.string().optional(),
      }),
    },
    async (args) => jsonResult(await fileBack(vault, search, args))
  )

  registerMcpTool(
    server,
    'lint_wiki',
    {
      description:
        'Wiki health check. deep=true adds broken links, stubs, stale pages, deprecated-still-linked. CI: `aio wiki-lint --fail`.',
      inputSchema: z.object({
        deep: z.boolean().optional(),
        stale_days: z.number().optional(),
      }),
    },
    async (args) =>
      jsonResult(await lintWiki(vault, { deep: args.deep === true, staleDays: args.stale_days }))
  )

  registerMcpTool(
    server,
    'propose_wiki_change',
    {
      description:
        'Create a wiki MR proposal (diff stored in .aio/wiki-proposals/). Review with list_wiki_proposals / wiki_diff, then apply_wiki_proposal or reject_wiki_proposal.',
      inputSchema: z.object({
        title: z.string(),
        content: z.string(),
        rationale: z.string().optional(),
        subdir: z.string().optional(),
      }),
    },
    async (args) => jsonResult(await proposeWikiChange(vault, args, resolveProjectRoot()))
  )

  registerMcpTool(
    server,
    'list_wiki_proposals',
    {
      description: 'List wiki change proposals (pending/applied/rejected).',
      inputSchema: z.object({
        status: z.enum(['pending', 'applied', 'rejected']).optional(),
      }),
    },
    async (args) => jsonResult(await listWikiProposals(resolveProjectRoot(), args.status))
  )

  registerMcpTool(
    server,
    'apply_wiki_proposal',
    {
      description: 'Apply a pending wiki proposal to the vault (human-approved merge).',
      inputSchema: z.object({
        id: z.string(),
        resolver: z.string().optional(),
      }),
    },
    async (args) => jsonResult(await applyWikiProposal(vault, search, args, resolveProjectRoot()))
  )

  registerMcpTool(
    server,
    'reject_wiki_proposal',
    {
      description: 'Reject a pending wiki proposal without changing wiki pages.',
      inputSchema: z.object({
        id: z.string(),
        reason: z.string().optional(),
        resolver: z.string().optional(),
      }),
    },
    async (args) => jsonResult(await rejectWikiProposal(args.id, args, resolveProjectRoot()))
  )

  registerMcpTool(
    server,
    'wiki_diff',
    {
      description: 'Preview diff lines for a proposed wiki page change before creating a proposal.',
      inputSchema: z.object({
        title: z.string(),
        content: z.string(),
        subdir: z.string().optional(),
      }),
    },
    async (args) => jsonResult(await wikiDiff(vault, args.title, args.content, args.subdir))
  )
}
