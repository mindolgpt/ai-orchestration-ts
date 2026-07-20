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

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

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
  server.registerTool(
    'get_wiki_schema',
    {
      description:
        'Read the vault wiki schema (AGENTS.md). Call this first when maintaining the wiki so you act as a disciplined wiki maintainer, not a generic chatbot.',
    },
    async () => jsonResult(await getWikiSchema(vault))
  )

  server.registerTool(
    'ingest_raw',
    {
      description:
        'Store an immutable original document under vault/raw/. Never modify raw later. Prefer this before ingest_source for durable knowledge.',
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
        return jsonResult(
          await ingestRawFromOpts(vault, {
            ...args,
            content: args.content || '',
            project_root: resolveProjectRoot(),
          })
        )
      } catch (err) {
        return jsonResult({ error: err instanceof Error ? err.message : String(err) })
      }
    }
  )

  server.registerTool(
    'ingest_source',
    {
      description:
        'Create/update ONE wiki concept page. Workflow: (1) get_wiki_schema (2) ingest_raw for originals (3) ingest_source per concept (4) update_wiki_page for related entities (5) confirm index.md + log.md. Do not put multiple concepts in one call.',
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
    async (args) => jsonResult(await ingestSource(vault, search, args))
  )

  server.registerTool(
    'ingest_source_batch',
    {
      description:
        'Create/update multiple wiki concept pages from one raw source. One entry in concepts[] = one page. Use subdir for taxonomy (domain, engineering, architecture, stacks).',
      inputSchema: z.object({
        concepts: z.array(conceptSchema).min(1),
        raw_id: z.string().optional(),
        source_path: z.string().optional(),
        default_subdir: z.string().optional(),
      }),
    },
    async (args) => jsonResult(await ingestSourceBatch(vault, search, args))
  )

  server.registerTool(
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
        lint_deep: z.boolean().optional(),
      }),
    },
    async (args) => {
      try {
        return jsonResult(
          await ingestPipeline(vault, search, {
            ...args,
            project_root: resolveProjectRoot(),
            run_lint: args.run_lint !== false,
          })
        )
      } catch (err) {
        return jsonResult({ error: err instanceof Error ? err.message : String(err) })
      }
    }
  )

  server.registerTool(
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
        return jsonResult({ error: err instanceof Error ? err.message : String(err) })
      }
    }
  )

  server.registerTool(
    'query_wiki',
    {
      description:
        'Search wiki pages and return full content + citations. Synthesize answers with citations. If the answer is durable, follow up with file_back.',
      inputSchema: z.object({
        query: z.string(),
        top_k: z.number().optional(),
      }),
    },
    async (args) => jsonResult(await queryWiki(vault, search, args.query, args.top_k ?? 5))
  )

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'list_wiki_proposals',
    {
      description: 'List wiki change proposals (pending/applied/rejected).',
      inputSchema: z.object({
        status: z.enum(['pending', 'applied', 'rejected']).optional(),
      }),
    },
    async (args) => jsonResult(await listWikiProposals(resolveProjectRoot(), args.status))
  )

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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
