import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApprovalGate } from "@/orchestrator/approval";
import { getEventLog } from "@/observability/events";
import { listWorktrees, removeWorktree } from "@/orchestrator/worktree";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function registerOpsTools(server: McpServer, approval: ApprovalGate): void {
  server.registerTool(
    "request_approval",
    {
      description:
        "Create a human-in-the-loop approval gate for risky actions (push, publish, destructive ops).",
      inputSchema: z.object({
        action: z.string(),
        reason: z.string(),
        risk: z.enum(["low", "medium", "high", "critical"]).optional(),
        meta: z.record(z.unknown()).optional(),
      }),
    },
    async (args) =>
      json(await approval.request(args.action, args.reason, args.risk || "high", args.meta))
  );

  server.registerTool(
    "resolve_approval",
    {
      description: "Approve or reject a pending approval request",
      inputSchema: z.object({
        approval_id: z.string(),
        approved: z.boolean(),
        resolver: z.string().optional(),
      }),
    },
    async (args) =>
      json(await approval.resolve(args.approval_id, args.approved, args.resolver || "human"))
  );

  server.registerTool(
    "list_approvals",
    {
      description: "List approval requests",
      inputSchema: z.object({
        status: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
      }),
    },
    async (args) => json({ approvals: approval.list(args.status) })
  );

  server.registerTool(
    "get_events",
    {
      description: "Recent orchestrator observability events (also written to .aio/events.jsonl)",
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
  );

  server.registerTool(
    "list_worktrees",
    {
      description: "List git worktrees (aio session isolation)",
    },
    async () => json({ porcelain: await listWorktrees() })
  );

  server.registerTool(
    "remove_worktree",
    {
      description: "Remove an aio session worktree",
      inputSchema: z.object({
        session_id: z.string(),
        delete_branch: z.boolean().optional(),
      }),
    },
    async (args) =>
      json(await removeWorktree(args.session_id, undefined, args.delete_branch === true))
  );
}
