import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { analyzeProject } from '@/static-analysis'
import { resolveProjectRoot } from '@/knowledge/paths'
import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { generateAndStoreSot } from '@/knowledge/sot-generator'
import { jsonResult } from '@/mcp/json-result'
import { registerMcpTool } from '@/mcp/register-tool'

export function registerAnalysisTools(
  server: McpServer,
  vault: ObsidianVault,
  search: SemanticSearch
): void {
  registerMcpTool(
    server,
    'analyze_codebase',
    {
      description:
        '정적 분석: 코드 그래프·라우트·모델 요약. 위키에 쌓으려면 generate_sot를 이어서 호출.',
      inputSchema: z.object({
        paths: z.array(z.string()).optional(),
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
      }),
    },
    async (args) => {
      const root = resolveProjectRoot()
      const roots = args.paths?.length ? args.paths : [root]
      const result = await analyzeProject(roots, {
        include: args.include,
        exclude: args.exclude,
      })
      return jsonResult({
        summary: result.summary,
        routes: result.routes.map((r) => ({ method: r.method, path: r.path, handler: r.handler })),
        models: result.models.map((m) => ({
          name: m.name,
          orm: m.orm,
          tableName: m.tableName,
          fields: m.fields.length,
        })),
        graph: {
          nodes: result.graph.nodes.size,
          edges: result.graph.edges.length,
        },
        next: 'Call generate_sot to persist architecture/API/data summaries into wiki/sot/ for RAG.',
      })
    }
  )

  registerMcpTool(
    server,
    'query_code_graph',
    {
      description: '코드 그래프 질의: 심볼 찾기, 호출 추적, 의존성 분석.',
      inputSchema: z.object({
        query: z.string(),
        mode: z.enum(['symbol', 'callers', 'callees', 'routes']),
        max_depth: z.number().optional(),
      }),
    },
    async (args) => {
      const root = resolveProjectRoot()
      const result = await analyzeProject([root], {
        include: [args.query.includes('.') ? args.query : `src/**/*${args.query}*`],
      })
      const nodes = Array.from(result.graph.nodes.values())
      const edges = result.graph.edges

      let matched = nodes.filter((n) => n.name.toLowerCase().includes(args.query.toLowerCase()))

      if (args.mode === 'callers') {
        const targetIds = new Set(matched.map((m) => m.id))
        matched = nodes.filter((n) =>
          edges.some((e) => targetIds.has(e.target) && e.source === n.id)
        )
      } else if (args.mode === 'callees') {
        const sourceIds = new Set(matched.map((m) => m.id))
        matched = nodes.filter((n) =>
          edges.some((e) => sourceIds.has(e.source) && e.target === n.id)
        )
      } else if (args.mode === 'routes') {
        matched = nodes.filter(
          (n) => n.kind === 'route' && n.name.toLowerCase().includes(args.query.toLowerCase())
        )
      }

      return jsonResult({
        query: args.query,
        mode: args.mode,
        results: matched.slice(0, 50).map((n) => ({
          id: n.id,
          kind: n.kind,
          name: n.name,
          file: n.filePath,
          metadata: n.metadata,
        })),
        total_matches: matched.length,
      })
    }
  )

  registerMcpTool(
    server,
    'generate_sot',
    {
      description:
        '정적 분석 → 서비스 백과사전(SOT)을 wiki/sot/에 저장하고 검색 인덱스에 반영. Keywords: 서비스 백과사전 / generate sot.',
      inputSchema: z.object({
        paths: z.array(z.string()).optional(),
        scope: z.enum(['full', 'incremental']).optional(),
        overwrite: z.boolean().optional(),
        update_index: z.boolean().optional(),
      }),
    },
    async (args) => {
      const root = resolveProjectRoot()
      const roots = args.paths?.length ? args.paths : [root]
      const stored = await generateAndStoreSot(vault, search, {
        projectRoots: roots,
        updateIndex: args.update_index !== false,
      })
      return jsonResult({
        ok: stored.ok,
        pages: stored.pages,
        errors: stored.errors,
        generated_at: new Date().toISOString(),
        next: stored.ok
          ? 'query_wiki for SOT pages (snippets). Prefer domain_context(format:path) for tasks.'
          : 'Fix errors and re-run generate_sot, or inspect vault/wiki/sot/.',
      })
    }
  )

  registerMcpTool(
    server,
    'code_graph_status',
    {
      description: '마지막 정적 분석 상태 조회.',
      inputSchema: z.object({}),
    },
    async () => {
      const root = resolveProjectRoot()
      const result = await analyzeProject([root])
      return jsonResult({
        last_analyzed: new Date(result.summary.analyzedAt).toISOString(),
        total_files: result.summary.totalFiles,
        total_nodes: result.summary.totalNodes,
        total_edges: result.summary.totalEdges,
        total_routes: result.summary.totalRoutes,
        total_models: result.summary.totalModels,
      })
    }
  )
}
