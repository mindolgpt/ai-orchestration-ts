/// <reference types="vitest/globals" />
import { registerDagTools } from "../src/mcp/tools/dag-tools";
import { DeepInterviewPlanner } from "../src/orchestrator/planner";
import { MessageInbox } from "../src/mcp/inbox";
import type { ChildSession } from "../src/mcp/tools/session-tools";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({
    pid: 999,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  })),
}));

function createMockServer() {
  const tools: Array<{ name: string; callback: Function }> = [];
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, callback: Function) => {
      tools.push({ name, callback });
    }),
  };
  return { server: server as unknown as McpServer, tools, getCallback: (name: string) => { const t = tools.find(x => x.name === name); if (!t) throw new Error(`Tool '${name}' not registered`); return t.callback; } };
}

describe("registerDagTools", () => {
  let sessions: Map<string, ChildSession>;
  let inbox: MessageInbox;
  let dagResults: Map<string, unknown>;

  beforeEach(() => {
    sessions = new Map();
    inbox = new MessageInbox();
    dagResults = new Map();
  });

  test("registers plan_task and execute_dag", () => {
    const { server, tools } = createMockServer();
    registerDagTools(server, new DeepInterviewPlanner(), sessions, inbox, dagResults, 5);
    expect(tools.map(t => t.name)).toEqual(["plan_task", "execute_dag"]);
  });

  test("plan_task returns plan from planner", async () => {
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
    expect(parsed.estimatedLayers).toBe(0);
  });

  test("execute_dag executes tasks in DAG layers", async () => {
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
  });

  test("execute_dag returns validation error for missing dependency", async () => {
    const { server, getCallback } = createMockServer();
    registerDagTools(server, new DeepInterviewPlanner(), sessions, inbox, dagResults, 5);

    const cb = getCallback("execute_dag");
    const result = await cb({
      plan_id: "plan_bad",
      tasks: [
        { id: "X", label: "X", deps: ["MISSING"] },
      ],
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
      tasks: [
        { id: "T1", label: "Task 1" },
      ],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results.layer_0[0].status).toBe("cached");
  });
});
