import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ApprovalGate } from '@/orchestrator/approval'
import { getEventLog } from '@/observability/events'
import { listWorktrees, removeWorktree } from '@/orchestrator/worktree'
import { runDoctor } from '@/doctor/check'
import { resolveProjectRoot } from '@/knowledge/paths'
import { jsonResult } from '@/mcp/json-result'
import { registerMcpTool } from '@/mcp/register-tool'

function json(data: unknown) {
  return jsonResult(data)
}

export function registerOpsTools(
  server: McpServer,
  approval: ApprovalGate,
  projectRoot?: string
): void {
  const root = projectRoot || resolveProjectRoot()
  registerMcpTool(
    server,
    'request_approval',
    {
      description:
        'Create a human-in-the-loop approval gate for risky actions (push, publish, destructive ops).',
      inputSchema: z.object({
        action: z.string(),
        reason: z.string(),
        risk: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        meta: z.record(z.unknown()).optional(),
      }),
    },
    async (args) =>
      json(await approval.request(args.action, args.reason, args.risk || 'high', args.meta))
  )

  registerMcpTool(
    server,
    'resolve_approval',
    {
      description:
        'Approve or reject a pending approval. Approving requires confirm_code from MCP server stderr ([aio:approval]), or use CLI: aio approval resolve <id> --approve. Reject does not need a code.',
      inputSchema: z.object({
        approval_id: z.string(),
        approved: z.boolean(),
        resolver: z.string().optional(),
        confirm_code: z.string().optional(),
      }),
    },
    async (args) =>
      json(
        await approval.resolve(args.approval_id, args.approved, args.resolver || 'human', {
          confirmCode: args.confirm_code,
        })
      )
  )

  registerMcpTool(
    server,
    'list_approvals',
    {
      description: 'List approval requests',
      inputSchema: z.object({
        status: z.enum(['pending', 'approved', 'rejected', 'expired']).optional(),
      }),
    },
    async (args) =>
      json({
        approvals: approval.list(args.status).map(({ confirmHash: _h, ...rest }) => rest),
      })
  )

  registerMcpTool(
    server,
    'get_events',
    {
      description: 'Recent orchestrator observability events (also written to .aio/events.jsonl)',
      inputSchema: z.object({
        limit: z.number().optional(),
        type_prefix: z.string().optional(),
      }),
    },
    async (args) =>
      json({
        path: getEventLog().path,
        events: getEventLog().recent(args.limit ?? 50, args.type_prefix),
      })
  )

  registerMcpTool(
    server,
    'list_worktrees',
    {
      description: 'List git worktrees (aio session isolation)',
      inputSchema: z.object({}),
    },
    async () => json({ porcelain: await listWorktrees() })
  )

  registerMcpTool(
    server,
    'run_doctor',
    {
      description:
        'Project health / onboarding diagnostic. Keywords: run doctor / 프로젝트 진단 / health check. Returns vault, harness, MCP, git, session runtime checks.',
      inputSchema: z.object({
        skip_embed_test: z.boolean().optional(),
      }),
    },
    async (args) =>
      json(
        await runDoctor({
          projectRoot: root,
          skipEmbedTest: args.skip_embed_test === true,
        })
      )
  )

  registerMcpTool(
    server,
    'remove_worktree',
    {
      description: 'Remove an aio session worktree',
      inputSchema: z.object({
        session_id: z.string(),
        delete_branch: z.boolean().optional(),
      }),
    },
    async (args) =>
      json(await removeWorktree(args.session_id, undefined, args.delete_branch === true))
  )
}
