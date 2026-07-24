import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ImpactAnalyzer } from '@/impact'
import { resolveProjectRoot } from '@/knowledge/paths'
import { jsonResult } from '@/mcp/json-result'
import { registerMcpTool } from '@/mcp/register-tool'

export function registerImpactTools(server: McpServer): void {
  // Lazy + project-root-aware analyzer. A single in-process MCP server is
  // typically bound to one project root, but resolveProjectRoot() may yield a
  // different path (e.g. env switch) between requests — we re-create the
  // analyzer only when that actually changes, so dossier state is preserved
  // within a project while still being adaptable to alternate roots.
  let cachedRoot: string | null = null
  let analyzer: ImpactAnalyzer | null = null
  function getAnalyzer(): ImpactAnalyzer {
    const root = resolveProjectRoot()
    if (!analyzer || cachedRoot !== root) {
      analyzer = new ImpactAnalyzer({ projectRoot: root, roots: [root] })
      cachedRoot = root
    }
    return analyzer
  }

  registerMcpTool(
    server,
    'impact_analyze',
    {
      description: '변경 제안 분석 → 영향도 dossier 생성. 변경 설명과 영향받을 파일을 입력.',
      inputSchema: z.object({
        change_description: z.string(),
        affected_files: z.array(z.string()).optional(),
        spec_ids: z.array(z.string()).optional(),
        epics: z.array(z.string()).optional(),
        depth: z.enum(['quick', 'full']).optional(),
      }),
    },
    async (args) => {
      const dossier = await getAnalyzer().analyze({
        changeDescription: args.change_description,
        affectedFiles: args.affected_files,
        specIds: args.spec_ids,
        epics: args.epics,
        depth: args.depth,
      })
      return jsonResult({
        dossier_id: dossier.id,
        status: dossier.status,
        impact_revision: dossier.impactRevision,
        surfaces: dossier.surfaces.map((s) => ({
          id: s.id,
          kind: s.kind,
          name: s.name,
          action: s.action,
          risk: s.risk,
        })),
        evidence_count: dossier.evidenceMatrix.length,
        evidence_summary: {
          confirmed: dossier.evidenceMatrix.filter((e) => e.coverage === 'confirmed-path').length,
          partial: dossier.evidenceMatrix.filter((e) => e.coverage === 'partial-path').length,
          candidate: dossier.evidenceMatrix.filter((e) => e.coverage === 'candidate').length,
        },
        risk_summary: {
          low: dossier.evidenceMatrix.filter((e) => e.risk === 'low').length,
          medium: dossier.evidenceMatrix.filter((e) => e.risk === 'medium').length,
          high: dossier.evidenceMatrix.filter((e) => e.risk === 'high').length,
        },
        coverage_limits: dossier.coverageLimits,
      })
    }
  )

  registerMcpTool(
    server,
    'impact_dossier_get',
    {
      description: '기존 영향도 dossier 상세 조회.',
      inputSchema: z.object({
        dossier_id: z.string(),
      }),
    },
    async (args) => {
      const dossier = getAnalyzer().getDossier(args.dossier_id)
      if (!dossier) return jsonResult({ ok: false, error: `Dossier ${args.dossier_id} not found` })
      return jsonResult(dossier)
    }
  )

  registerMcpTool(
    server,
    'impact_dossier_list',
    {
      description: '영향도 dossier 목록 조회.',
      inputSchema: z.object({}),
    },
    async () => {
      const list = getAnalyzer().listDossiers()
      return jsonResult({ dossiers: list, total: list.length })
    }
  )
}
