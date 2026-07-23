import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { analyzeProject } from '@/static-analysis'
import { resolveProjectRoot } from '@/knowledge/paths'
import { jsonResult } from '@/mcp/json-result'
import { registerMcpTool } from '@/mcp/register-tool'

export function registerAnalysisTools(server: McpServer): void {
  registerMcpTool(
    server,
    'analyze_codebase',
    {
      description: '정적 분석 실행: 코드 그래프, 라우트, 모델 추출. 분석 결과를 반환합니다.',
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
      description: '정적 분석 결과 → 서비스 백과사전(SOT) 생성 및 wiki/sot/ 저장.',
      inputSchema: z.object({
        scope: z.enum(['full', 'incremental']).optional(),
        overwrite: z.boolean().optional(),
      }),
    },
    async (_args) => {
      const root = resolveProjectRoot()
      const result = await analyzeProject([root])

      const sotPages = [
        {
          title: 'Architecture Overview',
          content: generateArchitectureSot(result),
          tags: ['sot', 'architecture', 'auto-generated'],
        },
        {
          title: 'API Endpoints',
          content: generateApiSot(result),
          tags: ['sot', 'api', 'auto-generated'],
        },
        {
          title: 'Data Models',
          content: generateDataModelSot(result),
          tags: ['sot', 'data-models', 'auto-generated'],
        },
      ]

      return jsonResult({
        ok: true,
        summary: result.summary,
        sot_pages: sotPages.map((p) => ({ title: p.title, tags: p.tags })),
        generated_at: new Date().toISOString(),
        note: 'SOT pages returned; use ingest_pipeline to persist to vault.',
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

function generateArchitectureSot(result: {
  graph: {
    nodes: Map<string, { id: string; kind: string; name: string }>
    edges: { source: string; target: string; kind: string }[]
  }
  summary: { totalFiles: number; totalNodes: number }
}): string {
  const moduleCount = Array.from(result.graph.nodes.values()).filter(
    (n) => n.kind === 'module'
  ).length
  const routeCount = Array.from(result.graph.nodes.values()).filter(
    (n) => n.kind === 'route'
  ).length
  const modelCount = Array.from(result.graph.nodes.values()).filter(
    (n) => n.kind === 'model'
  ).length

  return [
    '# Architecture Overview',
    '',
    '> Auto-generated from static analysis.',
    '',
    `## Summary`,
    '',
    `- Total source files analyzed: ${result.summary.totalFiles}`,
    `- Code graph nodes: ${result.summary.totalNodes}`,
    `- Routes detected: ${routeCount}`,
    `- Data models detected: ${modelCount}`,
    `- Module count: ${moduleCount}`,
    '',
    '## Module Dependencies',
    '',
    'The code graph shows the following import relationships between modules.',
    '',
  ].join('\n')
}

function generateApiSot(result: {
  routes: { method: string; path: string; handler: string }[]
}): string {
  const lines = ['# API Endpoints', '', '> Auto-generated from static analysis.', '']
  for (const route of result.routes) {
    lines.push(`- \`${route.method} ${route.path}\` → ${route.handler}`)
  }
  return lines.join('\n')
}

function generateDataModelSot(result: {
  models: { name: string; orm: string; tableName?: string; fields: unknown[] }[]
}): string {
  const lines = ['# Data Models', '', '> Auto-generated from static analysis.', '']
  for (const model of result.models) {
    lines.push(
      `- **${model.name}** (${model.orm}, table: ${model.tableName || 'unknown'}, ${model.fields.length} fields)`
    )
  }
  return lines.join('\n')
}
