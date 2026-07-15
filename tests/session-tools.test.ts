/// <reference types="vitest/globals" />
import { MessageInbox } from "../src/mcp/inbox";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "00000000-0000-0000-0000-000000000001"),
}));

import { spawnSession, waitForSession, registerSessionTools, ChildSession } from "../src/mcp/tools/session-tools";
import { spawn } from "child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function createMockServer() {
  const tools: Array<{ name: string; callback: Function }> = [];
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, callback: Function) => {
      tools.push({ name, callback });
    }),
    connect: vi.fn(),
  };
  return { server: server as unknown as McpServer, tools, getCallback: (name: string) => { const t = tools.find(x => x.name === name); if (!t) throw new Error(`Tool '${name}' not registered`); return t.callback; } };
}

function makeMockProc() {
  const closeHandlers: Array<() => void> = [];
  return {
    pid: 12345,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "close") closeHandlers.push(handler);
    }),
    triggerClose: (code: number) => closeHandlers.forEach(h => (h as unknown as (c: number) => void)(code)),
  };
}

describe("spawnSession", () => {
  let sessions: Map<string, ChildSession>;
  let inbox: MessageInbox;
  let mockProc: ReturnType<typeof makeMockProc>;

  beforeEach(() => {
    sessions = new Map();
    inbox = new MessageInbox();
    mockProc = makeMockProc();
    vi.mocked(spawn).mockReturnValue(mockProc as never);
    vi.clearAllMocks();
  });

  test("creates a session and spawns opencode process", async () => {
    const result = await spawnSession(sessions, inbox, 5, "do something", "context");

    expect(spawn).toHaveBeenCalledWith("opencode", ["run", expect.stringContaining("do something")], expect.any(Object));
    expect(result).toMatchObject({ session_id: "sess_00000000", pid: 12345, status: "running" });
    expect(sessions.size).toBe(1);
  });

  test("rejects when max sessions reached", async () => {
    sessions.set("existing", { id: "existing", status: "running", task: "", createdAt: 0 });
    const result = await spawnSession(sessions, inbox, 1, "task");
    expect(spawn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: "Max sessions exceeded (1)" });
  });

  test("updates session status on process close (exit 0)", async () => {
    await spawnSession(sessions, inbox, 5, "task");
    mockProc.triggerClose(0);
    const s = sessions.get("sess_00000000");
    expect(s?.status).toBe("completed");
    const msgs = inbox.poll();
    expect(msgs.length).toBe(1);
    expect(msgs[0].status).toBe("completed");
  });

  test("marks session failed on non-zero exit", async () => {
    await spawnSession(sessions, inbox, 5, "task");
    mockProc.triggerClose(1);
    const s = sessions.get("sess_00000000");
    expect(s?.status).toBe("failed");
  });
});

describe("waitForSession", () => {
  let sessions: Map<string, ChildSession>;
  let inbox: MessageInbox;

  beforeEach(() => {
    sessions = new Map();
    inbox = new MessageInbox();
  });

  test("returns completed status when session finishes", async () => {
    sessions.set("sess_1", { id: "sess_1", status: "completed", task: "", createdAt: 0 });
    inbox.post("sess_1", "test", "completed", { summary: "all good" });

    const result = await waitForSession(sessions, inbox, "sess_1", 5000);
    expect(result.status).toBe("completed");
    expect(result.result).toBe("all good");
  });

  test("returns timeout result when session does not finish", async () => {
    sessions.set("sess_slow", { id: "sess_slow", status: "running", task: "", createdAt: 0 });

    const result = await waitForSession(sessions, inbox, "sess_slow", 100);
    expect(result.status).toBe("timeout");
    expect(result.result).toBeNull();
  });
});

describe("registerSessionTools", () => {
  test("registers 7 session tools", () => {
    const { server, tools } = createMockServer();
    registerSessionTools(server, new Map(), new MessageInbox(), 5);

    const names = tools.map(t => t.name);
    expect(names).toEqual([
      "spawn_session", "check_inbox", "report_result",
      "send_message", "get_session", "close_session", "list_sessions",
    ]);
  });

  test("spawn_session callback calls spawnSession", async () => {
    const { server, getCallback } = createMockServer();
    const sessions = new Map<string, ChildSession>();
    const inbox = new MessageInbox();

    const mockProc2 = makeMockProc();
    vi.mocked(spawn).mockReturnValue(mockProc2 as never);

    registerSessionTools(server, sessions, inbox, 5);
    const cb = getCallback("spawn_session");
    const result = await cb({ task: "test task", context: "ctx" });

    expect(spawn).toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ status: "running" });
  });
});
