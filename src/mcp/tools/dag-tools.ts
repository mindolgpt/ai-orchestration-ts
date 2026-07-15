import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeepInterviewPlanner } from "@/orchestrator/planner";
import { createDAG, createTaskNode } from "@/dag";
import { ChildSession, spawnSession, waitForSession } from "@/mcp/tools/session-tools";
import { MessageInbox } from "@/mcp/inbox";

export function registerDagTools(
  server: McpServer,
  planner: DeepInterviewPlanner,
  sessions: Map<string, ChildSession>,
  inbox: MessageInbox,
  dagResults: Map<string, unknown>,
  maxSessions: number
): void {
  server.registerTool("plan_task", {
    description: "Decompose task into subtasks",
    inputSchema: z.object({ title: z.string(), description: z.string(), success_criteria: z.array(z.string()).optional(), constraints: z.array(z.string()).optional() }),
  }, async (args) => {
    const plan = planner.createPlan(args.title, args.description, args.success_criteria, args.constraints);
    return { content: [{ type: "text" as const, text: JSON.stringify({ plan_id: args.title, ...plan }) }] };
  });

  server.registerTool("execute_dag", {
    description: "Run DAG tasks in parallel layers",
    inputSchema: z.object({
      plan_id: z.string(),
      tasks: z.array(z.object({
        id: z.string(),
        label: z.string(),
        deps: z.array(z.string()).optional(),
        prompt: z.string().optional(),
      })),
    }),
  }, async (args) => {
    const dag = createDAG();
    for (const t of args.tasks) {
      dag.addNode(createTaskNode(t.id, t.label, undefined, t.deps));
    }

    const validationError = dag.validate();
    if (validationError) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: validationError }) }] };
    }

    const layers = dag.computeLayers();
    const layerCount = Object.keys(layers).length;
    const allSessionIds: string[] = [];
    const results: Record<string, unknown> = {};

    for (const [layerNum, nodes] of Object.entries(layers).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      const spawned = await Promise.all(
        nodes.map(async (node) => {
          const task = args.tasks.find(t => t.id === node.id);
          const existingResult = dagResults.get(node.id);

          if (existingResult !== undefined) {
            return { id: node.id, label: node.label, status: "cached" as const, result: existingResult };
          }

          if (task?.prompt) {
            try {
              const result = await spawnSession(sessions, inbox, maxSessions, task.prompt);
              allSessionIds.push(result.session_id as string);
              return { id: node.id, label: node.label, session_id: result.session_id, status: result.status };
            } catch (e) {
              return { id: node.id, label: node.label, status: "failed" as const, error: String(e) };
            }
          }

          return { id: node.id, label: node.label, status: "planned" as const };
        })
      );

      const sessionResults = await Promise.all(
        spawned.filter(s => "session_id" in s).map(async (s) => {
          const result = await waitForSession(sessions, inbox, s.session_id as string);
          return { ...s, final_status: result.status, result: result.result };
        })
      );

      const nonSessionResults = spawned.filter(s => !("session_id" in s));
      results[`layer_${layerNum}`] = [...nonSessionResults, ...sessionResults];
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        plan_id: args.plan_id,
        task_count: args.tasks.length,
        layer_count: layerCount,
        layers,
        results,
        status: "completed"
      }) }],
    };
  });
}
