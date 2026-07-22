import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { DeepInterviewPlanner } from '@/orchestrator/planner'
import { executeDagRun } from '@/orchestrator/execute-dag-run'
import { ChildSession } from '@/mcp/tools/session-tools'
import { MessageInbox } from '@/mcp/inbox'
import { ApprovalGate } from '@/orchestrator/approval'
import { resolveProjectRoot } from '@/knowledge/paths'
import { jsonResult } from '@/mcp/json-result'
import { registerMcpTool } from '@/mcp/register-tool'

export function registerDagTools(
  server: McpServer,
  planner: DeepInterviewPlanner,
  sessions: Map<string, ChildSession>,
  inbox: MessageInbox,
  dagResults: Map<string, unknown>,
  maxSessions: number,
  approval?: ApprovalGate,
  projectRoot?: string
): void {
  const root = projectRoot || resolveProjectRoot()

  registerMcpTool(
    server,
    'plan_task',
    {
      description:
        'Create a plan and suggested DAG stubs from success_criteria (one task per criterion).',
      inputSchema: z.object({
        title: z.string(),
        description: z.string(),
        success_criteria: z.array(z.string()).optional(),
        constraints: z.array(z.string()).optional(),
      }),
    },
    async (args) => {
      const plan = planner.createPlan(
        args.title,
        args.description,
        args.success_criteria,
        args.constraints
      )
      const criteria = args.success_criteria?.length
        ? args.success_criteria
        : ['Implement solution', 'Verify with tests']
      const suggested_tasks = criteria.map((c: string, i: number) => ({
        id: `T${i + 1}`,
        label: c.slice(0, 80),
        deps: i === 0 ? [] : [`T${i}`],
        prompt: `Plan: ${args.title}\nConstraint: ${(args.constraints || []).join('; ')}\nCriterion: ${c}\nReturn a concise summary via report_result.`,
      }))
      return jsonResult({
        plan_id: args.title,
        ...plan,
        estimatedLayers: suggested_tasks.length,
        suggested_tasks,
        next: 'Pass suggested_tasks (or your own) to execute_dag',
      })
    }
  )

  registerMcpTool(
    server,
    'execute_dag',
    {
      description:
        'Execute DAG via layer-parallel engine. Supports resume from checkpoint, fail_fast, worktree-per-task. Status: completed|partial|failed.',
      inputSchema: z.object({
        plan_id: z.string(),
        tasks: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            deps: z.array(z.string()).optional(),
            prompt: z.string().optional(),
            timeout_ms: z.number().optional(),
          })
        ),
        fail_fast: z.boolean().optional(),
        max_parallel: z.number().optional(),
        resume: z.boolean().optional(),
        clear_checkpoint: z.boolean().optional(),
        only_node_ids: z.array(z.string()).optional(),
        worktree: z.boolean().optional(),
        runtime: z.enum(['opencode', 'claude', 'cursor', 'codex', 'custom']).optional(),
        require_approval_if_dangerous: z.boolean().optional(),
        approval_id: z.string().optional(),
        skip_approval: z.boolean().optional(),
        ralph_max_retries: z.number().optional(),
        ralph_verify: z.boolean().optional(),
      }),
    },
    async (args) => {
      const result = await executeDagRun(
        {
          projectRoot: root,
          sessions,
          inbox,
          dagResults,
          maxSessions,
          approval,
        },
        args
      )
      return jsonResult(result)
    }
  )
}
