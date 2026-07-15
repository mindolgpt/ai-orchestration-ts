/// <reference types="vitest/globals" />
import { registerBranchTools } from "../src/mcp/tools/branch-tools";
import { BranchHunt } from "../src/orchestrator/branch-hunt";
import { MessageInbox } from "../src/mcp/inbox";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function createMockServer() {
  const tools: Array<{ name: string; callback: Function }> = [];
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, callback: Function) => {
      tools.push({ name, callback });
    }),
  };
  return { server: server as unknown as McpServer, tools, getCallback: (name: string) => { const t = tools.find(x => x.name === name); if (!t) throw new Error(`Tool '${name}' not registered`); return t.callback; } };
}

describe("registerBranchTools", () => {
  test("registers 3 branch tools", () => {
    const { server, tools } = createMockServer();
    const branchHunt = new BranchHunt(new MessageInbox());
    registerBranchTools(server, branchHunt);
    expect(tools.map(t => t.name)).toEqual(["scan_issues", "collect_results", "get_branch_status"]);
  });

  test("scan_issues calls branchHunt.scanForIssues", async () => {
    const { server, getCallback } = createMockServer();
    const branchHunt = new BranchHunt(new MessageInbox());
    registerBranchTools(server, branchHunt);

    const cb = getCallback("scan_issues");
    const result = await cb({ paths: ["src/"], severity: "high" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.found).toBeGreaterThanOrEqual(0);
    expect(parsed.issues).toBeDefined();
  });

  test("collect_results returns branch hunt results", async () => {
    const { server, getCallback } = createMockServer();
    const branchHunt = new BranchHunt(new MessageInbox());
    registerBranchTools(server, branchHunt);

    const cb = getCallback("collect_results");
    const result = await cb({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.collected).toBe(0);
  });

  test("get_branch_status returns summary", async () => {
    const { server, getCallback } = createMockServer();
    const branchHunt = new BranchHunt(new MessageInbox());
    registerBranchTools(server, branchHunt);

    const cb = getCallback("get_branch_status");
    const result = await cb({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.summary).toContain("Branch Hunt");
  });
});
