import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { SddPipeline } from '@/sdd/pipeline'
import { ApprovalGate } from '@/orchestrator/approval'
import { resolveProjectRoot } from '@/knowledge/paths'
import { jsonResult } from '@/mcp/json-result'
import { registerMcpTool } from '@/mcp/register-tool'

export function registerSddTools(server: McpServer, approval: ApprovalGate): void {
  const root = resolveProjectRoot()
  const pipeline = new SddPipeline(root, approval)

  registerMcpTool(
    server,
    'sdd_spec',
    {
      description: 'SDD Spec 생성: PRD + User Stories. 승인 게이트 포함.',
      inputSchema: z.object({
        project: z.string(),
        title: z.string(),
        product_context: z.string(),
        requirements: z.array(
          z.object({
            id: z.string(),
            priority: z.enum(['P0', 'P1', 'P2']),
            description: z.string(),
            acceptance_criteria: z.array(z.string()).optional(),
          })
        ),
      }),
    },
    async (args) => {
      const state = await pipeline.createSpec({
        project: args.project,
        title: args.title,
        productContext: args.product_context,
        requirements: args.requirements.map((r) => ({
          id: r.id,
          priority: r.priority,
          description: r.description,
          acceptanceCriteria: r.acceptance_criteria,
        })),
      })
      return jsonResult({
        stage: state.currentStage,
        spec_id: state.spec?.id,
        status: state.spec?.status,
        prd_path: state.spec?.prdPath,
        stories_path: state.spec?.storiesPath,
        next: 'Use sdd_approve to approve spec, then sdd_design',
      })
    }
  )

  registerMcpTool(
    server,
    'sdd_design',
    {
      description: '승인된 Spec → System Design 생성 (evidence-gated).',
      inputSchema: z.object({
        spec_id: z.string(),
      }),
    },
    async (args) => {
      const state = await pipeline.createDesign(args.spec_id)
      return jsonResult({
        stage: state.currentStage,
        spec_id: state.spec?.id,
        design_id: state.design?.id,
        status: state.design?.status,
        system_design_path: state.design?.systemDesignPath,
        next: 'Review system_design.md, collect evidence, then use sdd_approve',
        error: state.error,
      })
    }
  )

  registerMcpTool(
    server,
    'sdd_tasks',
    {
      description: '승인된 Design → Tasks.md 생성 (readiness 95+ 필요).',
      inputSchema: z.object({
        design_id: z.string(),
      }),
    },
    async (args) => {
      const state = await pipeline.generateTasks(args.design_id)
      return jsonResult({
        stage: state.currentStage,
        design_id: state.design?.id,
        tasks_path: state.tasks?.tasksPath,
        execution_readiness: state.tasks?.executionReadiness,
        error: state.error,
      })
    }
  )

  registerMcpTool(
    server,
    'sdd_approve',
    {
      description: 'SDD approval (spec 단계). sdd_approve_spec 또는 sdd_approve_design 사용.',
      inputSchema: z.object({
        id: z.string(),
        type: z.enum(['spec', 'design']),
        confirm_code: z.string().optional(),
      }),
    },
    async (args) => {
      if (args.type === 'spec') {
        const state = await pipeline.approveSpec(args.id)
        return jsonResult({
          type: 'spec',
          spec_id: state.spec?.id,
          status: state.spec?.status,
          error: state.error,
        })
      }
      return jsonResult({ error: 'Use sdd_approve_design for design approval' })
    }
  )

  registerMcpTool(
    server,
    'sdd_approve_design',
    {
      description: 'SDD design 승인. evidence 배열과 함께 호출.',
      inputSchema: z.object({
        design_id: z.string(),
        evidence: z
          .array(
            z.object({
              id: z.string(),
              proof: z.enum(['confirmed-path', 'partial-path', 'candidate']),
              source_file: z.string(),
              commit: z.string(),
              symbol: z.string(),
              line_range: z.array(z.number()).length(2).optional(),
              finding: z.string(),
            })
          )
          .optional(),
        confirm_code: z.string().optional(),
      }),
    },
    async (args) => {
      const evidence = (args.evidence || []).map((e) => ({
        id: e.id,
        proof: e.proof,
        sourceFile: e.source_file,
        commit: e.commit,
        symbol: e.symbol,
        lineRange:
          e.line_range?.length === 2
            ? ([e.line_range[0], e.line_range[1]] as [number, number])
            : ([0, 0] as [number, number]),
        finding: e.finding,
      }))
      const state = await pipeline.approveDesign(args.design_id, evidence, undefined)
      return jsonResult({
        design_id: state.design?.id,
        status: state.design?.status,
        approved_revision: state.design?.approvedRevision,
        error: state.error,
      })
    }
  )

  registerMcpTool(
    server,
    'sdd_status',
    {
      description: 'SDD 파이프라인 전체 상태 조회.',
      inputSchema: z.object({}),
    },
    async () => {
      const states = await pipeline.getState()
      return jsonResult({
        pipelines: states.map((s) => ({
          spec_id: s.spec?.id,
          spec_title: s.spec?.title,
          spec_status: s.spec?.status,
          design_id: s.design?.id,
          design_status: s.design?.status,
          current_stage: s.currentStage,
        })),
      })
    }
  )
}
