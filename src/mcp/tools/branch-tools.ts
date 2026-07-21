import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BranchHunt } from '@/orchestrator/branch-hunt'
import { ChildSession } from '@/mcp/tools/session-tools'
import { resolveProjectRoot } from '@/knowledge/paths'
import { registerMcpTool } from '@/mcp/register-tool'

export function registerBranchTools(
  server: McpServer,
  branchHunt: BranchHunt,
  sessions: Map<string, ChildSession>,
  maxSessions: number,
  projectRoot?: string
): void {
  const root = projectRoot || resolveProjectRoot()

  registerMcpTool(
    server,
    'scan_issues',
    {
      description:
        'Scan codebase (rg + .gitignore aware, walk fallback) for TODO/FIXME/HACK/XXX/empty-catch/eval. Optionally spawn fix sessions with worktree isolation.',
      inputSchema: z.object({
        paths: z.array(z.string()).optional(),
        severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        spawn_fixes: z.boolean().optional(),
        wait: z.boolean().optional(),
        clear: z.boolean().optional(),
        worktree: z.boolean().optional(),
        runtime: z.enum(['opencode', 'claude', 'cursor', 'codex', 'custom']).optional(),
      }),
    },
    async (args) => {
      try {
        if (args.clear) branchHunt.clear()
        const found = await branchHunt.scanPaths(root, args.paths, args.severity || 'low')
        let spawned = 0
        if (args.spawn_fixes) {
          const before = branchHunt.getIssues().filter((i) => i.sessionId).length
          await branchHunt.spawnFixes(sessions, maxSessions, {
            wait: args.wait,
            timeoutMs: 120_000,
            worktree: args.worktree,
            runtime: args.runtime,
          })
          spawned = branchHunt.getIssues().filter((i) => i.sessionId).length - before
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                found: found.length,
                spawned,
                issues: branchHunt.getIssues().map((i) => ({
                  id: i.id,
                  description: i.description,
                  file: i.file,
                  severity: i.severity,
                  session_id: i.sessionId,
                  resolved: i.resolved,
                })),
              }),
            },
          ],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
        }
      }
    }
  )

  registerMcpTool(
    server,
    'collect_results',
    {
      description: 'Collect branch-hunt results joined by issue.session_id',
      inputSchema: z.object({}),
    },
    async () => {
      const results = await branchHunt.collectResults(sessions)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ collected: results.length, results }),
          },
        ],
      }
    }
  )

  registerMcpTool(
    server,
    'get_branch_status',
    {
      description: 'Branch hunt status summary',
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            summary: branchHunt.summary(),
            issues: branchHunt.getIssues().map((i) => ({
              id: i.id,
              file: i.file,
              severity: i.severity,
              session_id: i.sessionId,
              resolved: i.resolved,
            })),
          }),
        },
      ],
    })
  )
}
