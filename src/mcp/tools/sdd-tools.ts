import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { SddPipeline } from '@/sdd/pipeline'
import { resolveProjectRoot } from '@/knowledge/paths'
import { jsonResult } from '@/mcp/json-result'
import { registerMcpTool } from '@/mcp/register-tool'
import { markAcceptanceItems } from '@/sdd/from-wiki'

export function registerSddTools(server: McpServer): void {
  const root = resolveProjectRoot()
  const pipeline = new SddPipeline(root)

  registerMcpTool(
    server,
    'sdd_spec',
    {
      description:
        'SDD Spec 생성: PRD + User Stories. Spec이 생성됨과 동시에 자동 승인되므로 ' +
        '별도 승인 도구 호출 없이 바로 sdd_design으로 이어집니다.',
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
        next: 'Design auto-approved. Call sdd_design to proceed.',
      })
    }
  )

  registerMcpTool(
    server,
    'sdd_design',
    {
      description: 'Spec → System Design 생성 (approval 게이트 없음, 생성 즉시 승인됨).',
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
        approved_revision: state.design?.approvedRevision,
        next: 'Design auto-approved. Call sdd_tasks to generate tasks.',
        error: state.error,
      })
    }
  )

  registerMcpTool(
    server,
    'sdd_tasks',
    {
      description:
        '승인된 Design → Tasks.md 생성. Design이 생성/수정된 후 일관성만 확인하고 Tasks를 생성합니다.',
      inputSchema: z.object({
        design_id: z.string(),
      }),
    },
    async (args) => {
      const state = await pipeline.generateTasks(args.design_id)
      return jsonResult({
        stage: state.currentStage,
        spec_id: state.spec?.id,
        design_id: state.design?.id,
        tasks_path: state.tasks?.tasksPath,
        execution_readiness: state.tasks?.executionReadiness,
        error: state.error,
      })
    }
  )

  registerMcpTool(
    server,
    'report_acceptance',
    {
      description:
        'Mark SDD acceptance-criteria items as pass/fail so the verify ladder acceptance step can pass. Keywords: acceptance 통과 / mark AC / report acceptance.',
      inputSchema: z.object({
        spec_id: z.string().optional(),
        items: z.array(
          z.object({
            id: z.string(),
            status: z.enum(['pass', 'fail', 'pending']),
            evidence: z.string().optional(),
          })
        ),
      }),
    },
    async (args) => {
      try {
        const res = await markAcceptanceItems(root, args.items, { specId: args.spec_id })
        return jsonResult({
          ok: true,
          file: res.file,
          updated: res.updated,
          unknown_ids: res.unknown,
          all_pass: res.all_pass,
          pending: res.items.filter((i) => i.status !== 'pass').map((i) => i.id),
          next: res.all_pass
            ? 'All AC pass — run_implement_loop / execute_dag acceptance step will pass'
            : 'Satisfy remaining AC then report_acceptance again',
        })
      } catch (err) {
        return jsonResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
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
