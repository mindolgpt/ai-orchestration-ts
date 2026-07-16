/// <reference types="vitest/globals" />
process.env.AIO_DISABLE_RG = "1";

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { registerBranchTools } from "../src/mcp/tools/branch-tools";
import { BranchHunt } from "../src/orchestrator/branch-hunt";
import { MessageInbox } from "../src/mcp/inbox";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => ({
      pid: 42,
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

describe("BranchHunt scan", () => {
  const prev = process.env.AIO_DISABLE_RG;

  beforeEach(() => {
    process.env.AIO_DISABLE_RG = "1";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.AIO_DISABLE_RG;
    else process.env.AIO_DISABLE_RG = prev;
  });

  test("finds FIXME in real files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aio-branch-"));
    await fs.writeFile(path.join(dir, "a.ts"), "const x = 1;\n// FIXME: broken\n", "utf-8");
    const hunt = new BranchHunt(new MessageInbox({ backend: "memory" }));
    const found = await hunt.scanPaths(dir, ["."], "high");
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0].description).toContain("FIXME");
    expect(found[0].sessionId).toBeUndefined();
  });

  test("collectResults joins by session_id", async () => {
    const inbox = new MessageInbox({ backend: "memory" });
    const hunt = new BranchHunt(inbox);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aio-branch-"));
    await fs.writeFile(path.join(dir, "b.ts"), "// TODO: later\n", "utf-8");
    await hunt.scanPaths(dir, ["."], "low");
    const issues = hunt.getIssues();
    issues[0].sessionId = "sess_x";
    inbox.post("sess_x", "session:sess_x", "completed", { summary: "fixed" });
    const results = await hunt.collectResults();
    expect(results[0]).toMatchObject({
      issue_id: issues[0].id,
      session_id: "sess_x",
      resolved: true,
      resolution: "fixed",
    });
  });
});

describe("registerBranchTools", () => {
  test("registers 3 branch tools", () => {
    const { server, tools } = createMockServer();
    const branchHunt = new BranchHunt(new MessageInbox({ backend: "memory" }));
    registerBranchTools(server, branchHunt, new Map(), 5);
    expect(tools.map((t) => t.name)).toEqual(["scan_issues", "collect_results", "get_branch_status"]);
  });

  test("scan_issues finds issues under projectRoot", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aio-branch-"));
    await fs.writeFile(path.join(dir, "c.ts"), "// HACK: temp\n", "utf-8");
    const { server, getCallback } = createMockServer();
    const branchHunt = new BranchHunt(new MessageInbox({ backend: "memory" }));
    registerBranchTools(server, branchHunt, new Map(), 5, dir);

    const cb = getCallback("scan_issues");
    const result = await cb({ paths: ["."], severity: "medium", clear: true });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.found).toBeGreaterThanOrEqual(1);
    expect(parsed.issues[0].description).toContain("HACK");
  });

  test("collect_results returns branch hunt results", async () => {
    const { server, getCallback } = createMockServer();
    const branchHunt = new BranchHunt(new MessageInbox({ backend: "memory" }));
    registerBranchTools(server, branchHunt, new Map(), 5);

    const cb = getCallback("collect_results");
    const result = await cb({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.collected).toBe(0);
  });

  test("get_branch_status returns summary", async () => {
    const { server, getCallback } = createMockServer();
    const branchHunt = new BranchHunt(new MessageInbox({ backend: "memory" }));
    registerBranchTools(server, branchHunt, new Map(), 5);

    const cb = getCallback("get_branch_status");
    const result = await cb({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.summary).toContain("Branch Hunt");
  });
});
