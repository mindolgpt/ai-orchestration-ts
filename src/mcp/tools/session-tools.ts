import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MessageInbox } from "@/mcp/inbox";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

export interface ChildSession {
  id: string;
  pid?: number;
  status: string;
  task: string;
  createdAt: number;
}

export async function spawnSession(
  sessions: Map<string, ChildSession>,
  inbox: MessageInbox,
  maxSessions: number,
  task: string,
  context?: string
): Promise<Record<string, unknown>> {
  if (sessions.size >= maxSessions) {
    return { error: `Max sessions exceeded (${maxSessions})` };
  }

  const sessionId = `sess_${randomUUID().slice(0, 8)}`;
  const prompt = context
    ? `[Context]\n${context}\n\n[Task]\n${task}\n\nReport result via report_result when done.`
    : task;

  const proc = spawn("opencode", ["run", prompt], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  });

  const session: ChildSession = { id: sessionId, pid: proc.pid, status: "running", task: task.slice(0, 80), createdAt: Date.now() };
  sessions.set(sessionId, session);

  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", () => {});

  proc.on("close", (code) => {
    const s = sessions.get(sessionId);
    if (s) s.status = code === 0 ? "completed" : "failed";
    inbox.post(sessionId, `session:${sessionId}`, code === 0 ? "completed" : "failed", {
      stdout: "", stderr: "", returncode: code
    });
  });

  return { session_id: sessionId, pid: proc.pid, status: "running", task: session.task };
}

export async function waitForSession(
  sessions: Map<string, ChildSession>,
  inbox: MessageInbox,
  sessionId: string,
  timeoutMs = 300000
): Promise<{ status: string; result: string | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = sessions.get(sessionId);
    if (session && (session.status === "completed" || session.status === "failed")) {
      const msgs = inbox.poll(sessionId);
      return {
        status: session.status,
        result: msgs.length > 0 ? (typeof msgs[0].payload?.summary === 'string' ? msgs[0].payload.summary : "").slice(0, 500) : null
      };
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return { status: "timeout", result: null };
}

export function registerSessionTools(
  server: McpServer,
  sessions: Map<string, ChildSession>,
  inbox: MessageInbox,
  maxSessions: number
): void {
  server.registerTool("spawn_session", {
    description: "Run task in new AI session",
    inputSchema: z.object({ task: z.string(), context: z.string().optional() }),
  }, async (args) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await spawnSession(sessions, inbox, maxSessions, args.task, args.context)) }],
  }));

  server.registerTool("check_inbox", {
    description: "Poll child session results",
    inputSchema: z.object({ session_id: z.string().optional(), status: z.string().optional() }),
  }, async (args) => ({
    content: [{ type: "text" as const, text: JSON.stringify({ messages: inbox.poll(args.session_id ?? undefined, args.status ?? undefined) }) }],
  }));

  server.registerTool("report_result", {
    description: "Report session result to parent",
    inputSchema: z.object({ session_id: z.string(), status: z.string(), summary: z.string() }),
  }, async (args) => {
    inbox.post(args.session_id, `session:${args.session_id}`, args.status, { summary: args.summary });
    const s = sessions.get(args.session_id);
    if (s) s.status = args.status;
    return { content: [{ type: "text" as const, text: JSON.stringify({ posted: true }) }] };
  });

  server.registerTool("send_message", {
    description: "Send instruction to a session",
    inputSchema: z.object({ session_id: z.string(), message: z.string() }),
  }, async (args) => {
    inbox.post(args.session_id, "parent", "instruction", { message: args.message });
    return { content: [{ type: "text" as const, text: JSON.stringify({ delivered: true }) }] };
  });

  server.registerTool("get_session", {
    description: "Get session status",
    inputSchema: z.object({ session_id: z.string() }),
  }, async (args) => {
    const s = sessions.get(args.session_id);
    if (!s) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Session ${args.session_id} not found` }) }] };
    return { content: [{ type: "text" as const, text: JSON.stringify({ id: s.id, pid: s.pid, status: s.status, task: s.task, duration: Date.now() - s.createdAt }) }] };
  });

  server.registerTool("close_session", {
    description: "Clean up a session",
    inputSchema: z.object({ session_id: z.string() }),
  }, async (args) => {
    if (sessions.has(args.session_id)) {
      sessions.delete(args.session_id);
      return { content: [{ type: "text" as const, text: JSON.stringify({ closed: true }) }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Session ${args.session_id} not found` }) }] };
  });

  server.registerTool("list_sessions", {
    description: "List all sessions",
  }, async () => ({
    content: [{ type: "text" as const, text: JSON.stringify({
      sessions: Array.from(sessions.values()).map(s => ({
        id: s.id, pid: s.pid, status: s.status, task: s.task, duration: Date.now() - s.createdAt
      }))
    }) }],
  }));
}
