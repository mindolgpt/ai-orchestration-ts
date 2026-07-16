import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeepInterviewPlanner } from "@/orchestrator/planner";
import { createDAG, createTaskNode } from "@/dag";
import { DAGExecutor } from "@/dag/engine";
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from "@/dag/checkpoint";
import { ChildSession, spawnSession, waitForSession } from "@/mcp/tools/session-tools";
import { MessageInbox } from "@/mcp/inbox";
import { getEventLog } from "@/observability/events";
import { ApprovalGate, looksDangerous } from "@/orchestrator/approval";
import { resolveProjectRoot } from "@/knowledge/paths";
import { TaskStatus } from "@/dag/types";

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
  const root = projectRoot || resolveProjectRoot();

  server.registerTool(
    "plan_task",
    {
      description:
        "Create a plan and suggested DAG stubs from success_criteria (one task per criterion).",
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
      );
      const criteria = args.success_criteria?.length
        ? args.success_criteria
        : ["Implement solution", "Verify with tests"];
      const suggested_tasks = criteria.map((c, i) => ({
        id: `T${i + 1}`,
        label: c.slice(0, 80),
        deps: i === 0 ? [] : [`T${i}`],
        prompt: `Plan: ${args.title}\nConstraint: ${(args.constraints || []).join("; ")}\nCriterion: ${c}\nReturn a concise summary via report_result.`,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              plan_id: args.title,
              ...plan,
              estimatedLayers: suggested_tasks.length,
              suggested_tasks,
              next: "Pass suggested_tasks (or your own) to execute_dag",
            }),
          },
        ],
      };
    }
  );

  server.registerTool(
    "execute_dag",
    {
      description:
        "Execute DAG via layer-parallel engine. Supports resume from checkpoint, fail_fast, worktree-per-task. Status: completed|partial|failed.",
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
        runtime: z.enum(["opencode", "claude", "cursor", "codex", "custom"]).optional(),
        require_approval_if_dangerous: z.boolean().optional(),
        approval_id: z.string().optional(),
        skip_approval: z.boolean().optional(),
      }),
    },
    async (args) => {
      if (args.clear_checkpoint) {
        await clearCheckpoint(args.plan_id, root);
      }

      const dag = createDAG();
      const promptById = new Map<string, string | undefined>();
      for (const t of args.tasks) {
        const node = createTaskNode(t.id, t.label, undefined, t.deps);
        if (t.timeout_ms) node.timeout = t.timeout_ms;
        dag.addNode(node);
        promptById.set(t.id, t.prompt);
      }

      const validationError = dag.validate();
      if (validationError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: validationError }) }],
        };
      }

      let seed: Record<string, unknown> = {};
      if (args.resume) {
        const cp = await loadCheckpoint(args.plan_id, root);
        if (cp) {
          seed = { ...cp.results };
          for (const [id, status] of Object.entries(cp.nodeStatuses)) {
            if (status === "success" && seed[id] !== undefined) {
              const n = dag.getNode(id);
              if (n) {
                n.status = "success";
                n.result = seed[id];
              }
            }
          }
          for (const [id, val] of Object.entries(seed)) {
            dagResults.set(id, val);
          }
        }
      }

      // Merge in-memory cache
      for (const [id, val] of dagResults) {
        if (!(id in seed)) seed[id] = val;
      }

      const needGate =
        args.require_approval_if_dangerous !== false && !args.skip_approval && !!approval;
      if (needGate && approval) {
        let approved = false;
        if (args.approval_id) {
          const existing = approval.get(args.approval_id);
          approved = existing?.status === "approved";
          if (existing && existing.status !== "approved") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    blocked: true,
                    reason: "approval_not_granted",
                    approval_id: args.approval_id,
                    status: existing.status,
                  }),
                },
              ],
            };
          }
        }
        if (!approved) {
          const dangerous = args.tasks.filter(
            (t) => looksDangerous(t.prompt || "") || looksDangerous(t.label)
          );
          if (dangerous.length) {
            const req = await approval.request(
              "execute_dag",
              `Plan ${args.plan_id} has ${dangerous.length} potentially dangerous task(s): ${dangerous
                .map((d) => d.id)
                .join(", ")}`,
              "high",
              { plan_id: args.plan_id, task_ids: dangerous.map((d) => d.id) }
            );
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    blocked: true,
                    reason: "approval_required",
                    approval_id: req.id,
                    message:
                      "Call resolve_approval({approved:true}) then re-run execute_dag with approval_id.",
                  }),
                },
              ],
            };
          }
        }
      }

      const executor = new DAGExecutor(dag, args.max_parallel ?? Math.min(5, maxSessions));
      const layerMeta = dag.computeLayers();

      await getEventLog().emit("dag.start", {
        plan_id: args.plan_id,
        tasks: args.tasks.length,
        resume: !!args.resume,
      });

      const run = await executor.execute(
        async (node, depResults) => {
          if (dagResults.has(node.id) && seed[node.id] !== undefined) {
            // Already seeded as success by engine — shouldn't be called, but safe
            return dagResults.get(node.id);
          }
          if (dagResults.has(node.id) && !promptById.get(node.id)) {
            return { cached: true, result: dagResults.get(node.id) };
          }

          const prompt = promptById.get(node.id);
          if (!prompt) {
            return { planned: true, label: node.label };
          }

          // Skip re-run if seeded
          if (seed[node.id] !== undefined) {
            return seed[node.id];
          }

          const context = Object.keys(depResults).length
            ? `Upstream results:\n${JSON.stringify(depResults, null, 2).slice(0, 4000)}`
            : undefined;

          const spawned = await spawnSession(sessions, inbox, maxSessions, prompt, context, {
            worktree: args.worktree,
            runtime: args.runtime,
            projectRoot: root,
          });
          if (spawned.error || !spawned.session_id) {
            throw new Error(String(spawned.error || "spawn failed"));
          }

          const waited = await waitForSession(
            sessions,
            inbox,
            spawned.session_id as string,
            node.timeout || 300_000
          );
          if (waited.status !== "completed") {
            throw new Error(`session ${spawned.session_id} ended with ${waited.status}`);
          }

          const payload = {
            session_id: spawned.session_id,
            summary: waited.result,
          };
          dagResults.set(node.id, payload);
          return payload;
        },
        {
          failFast: args.fail_fast ?? false,
          seedResults: seed,
          onlyNodeIds: args.only_node_ids,
          onNodeDone: async (node, results) => {
            const nodeStatuses: Record<string, TaskStatus> = {};
            for (const n of dag.nodes.values()) {
              nodeStatuses[n.id] = n.status;
            }
            const resultsObj: Record<string, unknown> = {};
            for (const [k, v] of results) resultsObj[k] = v;
            await saveCheckpoint(
              {
                planId: args.plan_id,
                results: resultsObj,
                nodeStatuses,
                updatedAt: Date.now(),
              },
              root
            );
            await getEventLog().emit("dag.node", {
              plan_id: args.plan_id,
              node_id: node.id,
              status: node.status,
            });
          },
        }
      );

      if (run.status === "completed") {
        await clearCheckpoint(args.plan_id, root);
      }

      await getEventLog().emit("dag.done", {
        plan_id: args.plan_id,
        status: run.status,
        success: run.success,
        failed: run.failed,
        skipped: run.skipped,
      });

      const nodeStatuses = Array.from(dag.nodes.values()).map((n) => ({
        id: n.id,
        label: n.label,
        status: n.status,
        error: n.error,
        result: n.result,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              plan_id: args.plan_id,
              task_count: args.tasks.length,
              layer_count: Object.keys(layerMeta).length,
              layers: layerMeta,
              status: run.status,
              success: run.success,
              failed: run.failed,
              skipped: run.skipped,
              resumed: !!args.resume,
              checkpoint: run.status === "completed" ? null : `.aio/checkpoints/${args.plan_id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}.json`,
              nodes: nodeStatuses,
            }),
          },
        ],
      };
    }
  );
}
