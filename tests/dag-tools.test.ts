/// <reference types="vitest/globals" />
import { registerDagTools } from "../src/mcp/tools/dag-tools";
import { DeepInterviewPlanner } from "../src/orchestrator/planner";
import { MessageInbox } from "../src/mcp/inbox";
import type { ChildSession } from "../src/mcp/tools/session-tools";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDAG, createTaskNode, DAGExecutor } from "../src/dag";

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => ({
      pid: 999,
      killed: false,
      kill: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    })),
  };
});

function createMockServer() {
  const tools: Array<{ name: string; callback: Function }> = [];
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, callback: Function) => {
      tools.push({ name, callback });
    }),
  };
  return {
    server: server as unknown as McpServer,
    tools,
    getCallback: (name: string) => {
      const t = tools.find((x) => x.name === name);
      if (!t) throw new Error(`Tool '${name}' not registered`);
      return t.callback;
    },
  };
}

describe("DAGExecutor skip / partial", () => {
  test("skips dependents when dependency fails", async () => {
    const dag = createDAG();
    dag.addNode(createTaskNode("A", "A"));
    dag.addNode(createTaskNode("B", "B", undefined, ["A"]));
    dag.addNode(createTaskNode("C", "C", undefined, ["B"]));

    const executor = new DAGExecutor(dag, 2);
    const result = await executor.execute(async (node) => {
      if (node.id === "A") throw new Error("boom");
      return "ok";
    });

    expect(result.status).toBe("failed");
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.success).toBe(0);
    expect(dag.getNode("B")?.status).toBe("skipped");
    expect(dag.getNode("C")?.status).toBe("skipped");
  });

  test("partial when some succeed and some fail", async () => {
    const dag = createDAG();
    dag.addNode(createTaskNode("A", "A"));
    dag.addNode(createTaskNode("B", "B"));
    dag.addNode(createTaskNode("C", "C", undefined, ["B"]));

    const executor = new DAGExecutor(dag, 2);
    const result = await executor.execute(async (node) => {
      if (node.id === "B") throw new Error("boom");
      return "ok";
    });

    expect(result.status).toBe("partial");
    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
  });

  test("passes depResults to runner", async () => {
    const dag = createDAG();
    dag.addNode(createTaskNode("A", "A"));
    dag.addNode(createTaskNode("B", "B", undefined, ["A"]));
    const seen: Record<string, unknown>[] = [];
    const executor = new DAGExecutor(dag, 2);
    await executor.execute(async (node, deps) => {
      seen.push({ id: node.id, deps });
      return `out-${node.id}`;
    });
    expect(seen[1].deps).toEqual({ A: "out-A" });
  });
});

describe("registerDagTools", () => {
  let sessions: Map<string, ChildSession>;
  let inbox: MessageInbox;
  let dagResults: Map<string, unknown>;

  beforeEach(() => {
    sessions = new Map();
    inbox = new MessageInbox({ backend: "memory" });
    dagResults = new Map();
  });

  test("registers plan_task and execute_dag", () => {
    const { server, tools } = createMockServer();
    registerDagTools(server, new DeepInterviewPlanner(), sessions, inbox, dagResults, 5);
    expect(tools.map((t) => t.name)).toEqual(["plan_task", "execute_dag"]);
  });

  test("plan_task returns suggested_tasks DAG stubs", async () => {
    const { server, getCallback } = createMockServer();
    registerDagTools(server, new DeepInterviewPlanner(), sessions, inbox, dagResults, 5);

    const cb = getCallback("plan_task");
    const result = await cb({
      title: "Test Plan",
      description: "A test",
      success_criteria: ["done"],
      constraints: [],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.plan_id).toBe("Test Plan");
    expect(parsed.description).toBe("A test");
    expect(parsed.estimatedLayers).toBe(1);
    expect(parsed.suggested_tasks).toHaveLength(1);
    expect(parsed.suggested_tasks[0].id).toBe("T1");
  });

  test("execute_dag executes planned tasks without prompts", async () => {
    const { server, getCallback } = createMockServer();
    registerDagTools(server, new DeepInterviewPlanner(), sessions, inbox, dagResults, 5);

    const cb = getCallback("execute_dag");
    const result = await cb({
      plan_id: "plan_1",
      tasks: [
        { id: "T1", label: "Task 1" },
        { id: "T2", label: "Task 2", deps: ["T1"] },
      ],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("completed");
    expect(parsed.task_count).toBe(2);
    expect(parsed.layer_count).toBe(2);
    expect(parsed.success).toBe(2);
    expect(parsed.nodes.every((n: { status: string }) => n.status === "success")).toBe(true);
  });

  test("execute_dag returns validation error for missing dependency", async () => {
    const { server, getCallback } = createMockServer();
    registerDagTools(server, new DeepInterviewPlanner(), sessions, inbox, dagResults, 5);

    const cb = getCallback("execute_dag");
    const result = await cb({
      plan_id: "plan_bad",
      tasks: [{ id: "X", label: "X", deps: ["MISSING"] }],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("MISSING");
  });

  test("execute_dag uses cached results when available", async () => {
    const { server, getCallback } = createMockServer();
    dagResults.set("T1", { cached: true });

    registerDagTools(server, new DeepInterviewPlanner(), sessions, inbox, dagResults, 5);

    const cb = getCallback("execute_dag");
    const result = await cb({
      plan_id: "plan_3",
      tasks: [{ id: "T1", label: "Task 1" }],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("completed");
    expect(parsed.nodes[0].status).toBe("success");
    expect(parsed.nodes[0].result).toMatchObject({ cached: true });
  });
});
