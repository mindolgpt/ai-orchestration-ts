import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { MessageInbox } from '@/mcp/inbox'
import { ChildProcess, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { resolveSessionSpawn, listSessionRuntimes } from '@/mcp/session-runtime'
import { createWorktree, removeWorktree } from '@/orchestrator/worktree'
import { getEventLog } from '@/observability/events'
import { resolveProjectRoot } from '@/knowledge/paths'

export interface ChildSession {
  id: string
  pid?: number
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'killed'
  task: string
  createdAt: number
  stdout: string
  stderr: string
  returncode?: number | null
  pendingMessages: string[]
  proc?: ChildProcess
  runtime?: string
  worktreePath?: string
  worktreeBranch?: string
  cwd?: string
}

export interface SpawnSessionOptions {
  command?: string
  argsPrefix?: string[]
  runtime?: string
  worktree?: boolean
  cwd?: string
  projectRoot?: string
}

function runningCount(sessions: Map<string, ChildSession>): number {
  return Array.from(sessions.values()).filter((s) => s.status === 'running').length
}

function buildChildPrompt(sessionId: string, task: string, context?: string): string {
  const parts = [
    `[Session ID]\n${sessionId}`,
    context ? `[Context]\n${context}` : '',
    `[Task]\n${task}`,
    `[Instructions]
- You are an isolated child session. Do not talk to the end user directly.
- When finished, call report_result with session_id="${sessionId}", status="completed"|"failed", and a concise summary.
- Keep the summary under 2000 characters.`,
  ]
  return parts.filter(Boolean).join('\n\n')
}

function killProcess(proc?: ChildProcess): void {
  if (!proc || proc.killed) return
  try {
    if (process.platform === 'win32' && proc.pid) {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL')
      }, 2000).unref?.()
    }
  } catch {
    /* ignore */
  }
}

export async function spawnSession(
  sessions: Map<string, ChildSession>,
  inbox: MessageInbox,
  maxSessions: number,
  task: string,
  context?: string,
  opts?: SpawnSessionOptions
): Promise<Record<string, unknown>> {
  if (runningCount(sessions) >= maxSessions) {
    return { error: `Max running sessions exceeded (${maxSessions})` }
  }

  const sessionId = `sess_${randomUUID().slice(0, 8)}`
  const prompt = buildChildPrompt(sessionId, task, context)
  const projectRoot = opts?.projectRoot || resolveProjectRoot()
  const spec = resolveSessionSpawn(prompt, {
    runtime: opts?.runtime,
    command: opts?.command,
    argsPrefix: opts?.argsPrefix,
  })

  let worktreePath: string | undefined
  let worktreeBranch: string | undefined
  let cwd = opts?.cwd || projectRoot

  if (opts?.worktree) {
    try {
      const wt = await createWorktree(sessionId, projectRoot)
      worktreePath = wt.path
      worktreeBranch = wt.branch
      cwd = wt.path
    } catch (err) {
      return {
        error: `Worktree failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  let proc: ChildProcess
  try {
    proc = spawn(spec.command, spec.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      cwd,
      env: {
        ...process.env,
        AIO_SESSION_ID: sessionId,
        AIO_PARENT_ORCHESTRATOR: '1',
        AIO_SESSION_RUNTIME: spec.runtime,
        ...(worktreePath ? { AIO_WORKTREE: worktreePath } : {}),
      },
    })
  } catch (err) {
    if (worktreePath) await removeWorktree(sessionId, projectRoot).catch(() => {})
    return {
      error: `Failed to spawn ${spec.command}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const session: ChildSession = {
    id: sessionId,
    pid: proc.pid,
    status: 'running',
    task: task.slice(0, 120),
    createdAt: Date.now(),
    stdout: '',
    stderr: '',
    pendingMessages: [],
    proc,
    runtime: spec.runtime,
    worktreePath,
    worktreeBranch,
    cwd,
  }
  sessions.set(sessionId, session)

  proc.stdout?.on('data', (chunk: Buffer | string) => {
    session.stdout = (session.stdout + String(chunk)).slice(-50_000)
  })
  proc.stderr?.on('data', (chunk: Buffer | string) => {
    session.stderr = (session.stderr + String(chunk)).slice(-50_000)
  })

  proc.on('error', (err) => {
    session.status = 'failed'
    session.stderr = (session.stderr + '\n' + err.message).slice(-50_000)
    inbox.post(sessionId, `session:${sessionId}`, 'failed', {
      summary: err.message,
      stdout: session.stdout.slice(-2000),
      stderr: session.stderr.slice(-2000),
      returncode: null,
    })
    void getEventLog().emit('session.error', { session_id: sessionId, error: err.message }, 'error')
  })

  proc.on('close', (code) => {
    if (session.status === 'timeout' || session.status === 'killed') {
      inbox.post(sessionId, `session:${sessionId}`, session.status, {
        summary: session.status,
        stdout: session.stdout.slice(-2000),
        stderr: session.stderr.slice(-2000),
        returncode: code,
      })
      return
    }
    session.returncode = code
    session.status = code === 0 ? 'completed' : 'failed'
    const existing = inbox.poll(sessionId)
    const hasSummary = existing.some(
      (m) => typeof m.payload?.summary === 'string' && m.payload.summary
    )
    if (!hasSummary) {
      inbox.post(sessionId, `session:${sessionId}`, session.status, {
        summary: session.stdout.trim().slice(0, 500) || `exit=${code}`,
        stdout: session.stdout.slice(-2000),
        stderr: session.stderr.slice(-2000),
        returncode: code,
      })
    }
    void getEventLog().emit('session.closed', {
      session_id: sessionId,
      status: session.status,
      returncode: code,
      duration_ms: Date.now() - session.createdAt,
    })
  })

  await getEventLog().emit('session.spawned', {
    session_id: sessionId,
    runtime: spec.runtime,
    command: spec.command,
    worktree: !!worktreePath,
  })

  return {
    session_id: sessionId,
    pid: proc.pid,
    status: 'running',
    task: session.task,
    isolated: true,
    runtime: spec.runtime,
    command: spec.command,
    worktree: worktreePath || null,
    worktree_branch: worktreeBranch || null,
  }
}

export async function waitForSession(
  sessions: Map<string, ChildSession>,
  inbox: MessageInbox,
  sessionId: string,
  timeoutMs = 300_000
): Promise<{ status: string; result: string | null; returncode?: number | null }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const session = sessions.get(sessionId)
    if (!session) {
      return { status: 'missing', result: null }
    }
    if (
      session.status === 'completed' ||
      session.status === 'failed' ||
      session.status === 'killed'
    ) {
      const msgs = inbox.poll(sessionId)
      const withSummary = msgs.find((m) => typeof m.payload?.summary === 'string')
      const summary =
        (withSummary?.payload?.summary as string | undefined) ||
        session.stdout.trim().slice(0, 500) ||
        null
      return { status: session.status, result: summary, returncode: session.returncode }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  const session = sessions.get(sessionId)
  if (session) {
    session.status = 'timeout'
    killProcess(session.proc)
    inbox.post(sessionId, `session:${sessionId}`, 'timeout', {
      summary: `Timed out after ${timeoutMs}ms`,
      stdout: session.stdout.slice(-2000),
      stderr: session.stderr.slice(-2000),
      returncode: null,
    })
    await getEventLog().emit(
      'session.timeout',
      { session_id: sessionId, timeout_ms: timeoutMs },
      'warn'
    )
  }
  return { status: 'timeout', result: null }
}

export async function closeSession(
  sessions: Map<string, ChildSession>,
  sessionId: string,
  kill = true,
  removeWt = false
): Promise<Record<string, unknown>> {
  const session = sessions.get(sessionId)
  if (!session) return { error: `Session ${sessionId} not found` }
  if (kill && session.status === 'running') {
    session.status = 'killed'
    killProcess(session.proc)
  }
  let worktreeRemoved = false
  if (removeWt && session.worktreePath) {
    const r = await removeWorktree(sessionId)
    worktreeRemoved = r.removed
  }
  sessions.delete(sessionId)
  return {
    closed: true,
    killed: kill && session.status === 'killed',
    worktree_removed: worktreeRemoved,
  }
}

export function synthesizeResults(
  sessions: Map<string, ChildSession>,
  inbox: MessageInbox,
  dagResults: Map<string, unknown>,
  opts?: { session_ids?: string[]; plan_id?: string; format?: 'markdown' | 'json' }
): Record<string, unknown> {
  const format = opts?.format || 'markdown'
  const ids = opts?.session_ids
  const sessionList = ids?.length
    ? ids.map((id) => sessions.get(id)).filter((s): s is ChildSession => !!s)
    : Array.from(sessions.values())

  const sessionSummaries = sessionList.map((s) => {
    const msgs = inbox.peek(s.id)
    const last = [...msgs].reverse().find((m) => typeof m.payload?.summary === 'string')
    return {
      session_id: s.id,
      status: s.status,
      task: s.task,
      summary:
        (last?.payload?.summary as string | undefined) || s.stdout.trim().slice(0, 400) || null,
      duration_ms: Date.now() - s.createdAt,
      worktree: s.worktreePath || null,
    }
  })

  const dagEntries = Array.from(dagResults.entries()).map(([id, result]) => ({
    task_id: id,
    result,
  }))

  if (format === 'json') {
    return {
      plan_id: opts?.plan_id || null,
      sessions: sessionSummaries,
      dag: dagEntries,
      synthesized_at: new Date().toISOString(),
    }
  }

  const lines = [
    `# Synthesis${opts?.plan_id ? `: ${opts.plan_id}` : ''}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Sessions',
  ]
  if (!sessionSummaries.length) lines.push('_No sessions_')
  for (const s of sessionSummaries) {
    lines.push(`### ${s.session_id} (${s.status})`)
    lines.push(`- Task: ${s.task}`)
    lines.push(`- Summary: ${s.summary || '(none)'}`)
    lines.push('')
  }
  if (dagEntries.length) {
    lines.push('## DAG results')
    for (const d of dagEntries) {
      lines.push(`- **${d.task_id}**: ${JSON.stringify(d.result).slice(0, 300)}`)
    }
  }
  return { format: 'markdown', markdown: lines.join('\n'), session_count: sessionSummaries.length }
}

export function registerSessionTools(
  server: McpServer,
  sessions: Map<string, ChildSession>,
  inbox: MessageInbox,
  maxSessions: number,
  dagResults?: Map<string, unknown>
): void {
  const results = dagResults || new Map<string, unknown>()

  server.registerTool(
    'spawn_session',
    {
      description:
        'Spawn an isolated child AI session. runtime: opencode|claude|cursor|codex|custom. Optional git worktree isolation.',
      inputSchema: z.object({
        task: z.string(),
        context: z.string().optional(),
        timeout_ms: z.number().optional(),
        runtime: z.enum(['opencode', 'claude', 'cursor', 'codex', 'custom']).optional(),
        worktree: z.boolean().optional(),
      }),
    },
    async (args) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            await spawnSession(sessions, inbox, maxSessions, args.task, args.context, {
              runtime: args.runtime,
              worktree: args.worktree,
            })
          ),
        },
      ],
    })
  )

  server.registerTool(
    'check_inbox',
    {
      description: 'Poll child session results (unread)',
      inputSchema: z.object({
        session_id: z.string().optional(),
        status: z.string().optional(),
      }),
    },
    async (args) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            backend: inbox.backendName,
            messages: inbox.poll(args.session_id ?? undefined, args.status ?? undefined),
          }),
        },
      ],
    })
  )

  server.registerTool(
    'report_result',
    {
      description: 'Child reports result to parent inbox (include session_id from spawn prompt)',
      inputSchema: z.object({
        session_id: z.string(),
        status: z.string(),
        summary: z.string(),
      }),
    },
    async (args) => {
      inbox.post(args.session_id, `session:${args.session_id}`, args.status, {
        summary: args.summary,
      })
      const s = sessions.get(args.session_id)
      if (s && (args.status === 'completed' || args.status === 'failed')) {
        s.status = args.status
      }
      await getEventLog().emit('session.report', {
        session_id: args.session_id,
        status: args.status,
      })
      return { content: [{ type: 'text' as const, text: JSON.stringify({ posted: true }) }] }
    }
  )

  server.registerTool(
    'send_message',
    {
      description: 'Queue an instruction for a session (pending_messages). Not a live IPC channel.',
      inputSchema: z.object({ session_id: z.string(), message: z.string() }),
    },
    async (args) => {
      const s = sessions.get(args.session_id)
      if (!s) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'session not found' }) },
          ],
        }
      }
      s.pendingMessages.push(args.message)
      inbox.post(args.session_id, 'parent', 'instruction', { message: args.message })
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ queued: true, pending_count: s.pendingMessages.length }),
          },
        ],
      }
    }
  )

  server.registerTool(
    'get_session',
    {
      description: 'Get session status, logs, pending messages, worktree',
      inputSchema: z.object({ session_id: z.string() }),
    },
    async (args) => {
      const s = sessions.get(args.session_id)
      if (!s) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Session ${args.session_id} not found` }),
            },
          ],
        }
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              id: s.id,
              pid: s.pid,
              status: s.status,
              task: s.task,
              runtime: s.runtime,
              cwd: s.cwd,
              worktree: s.worktreePath,
              worktree_branch: s.worktreeBranch,
              duration: Date.now() - s.createdAt,
              returncode: s.returncode ?? null,
              pending_messages: s.pendingMessages,
              stdout_tail: s.stdout.slice(-1000),
              stderr_tail: s.stderr.slice(-1000),
            }),
          },
        ],
      }
    }
  )

  server.registerTool(
    'close_session',
    {
      description: 'Kill running process if needed and remove session; optional worktree cleanup',
      inputSchema: z.object({
        session_id: z.string(),
        kill: z.boolean().optional(),
        remove_worktree: z.boolean().optional(),
      }),
    },
    async (args) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            await closeSession(
              sessions,
              args.session_id,
              args.kill !== false,
              args.remove_worktree === true
            )
          ),
        },
      ],
    })
  )

  server.registerTool(
    'list_sessions',
    {
      description: 'List sessions (running count used for maxSessions)',
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            running: runningCount(sessions),
            max_sessions: maxSessions,
            runtimes: listSessionRuntimes(),
            sessions: Array.from(sessions.values()).map((s) => ({
              id: s.id,
              pid: s.pid,
              status: s.status,
              task: s.task,
              runtime: s.runtime,
              worktree: s.worktreePath || null,
              duration: Date.now() - s.createdAt,
            })),
          }),
        },
      ],
    })
  )

  server.registerTool(
    'synthesize_results',
    {
      description:
        'Parent synthesizes child session + DAG results into markdown or JSON summary (does not talk to end-user as a child).',
      inputSchema: z.object({
        session_ids: z.array(z.string()).optional(),
        plan_id: z.string().optional(),
        format: z.enum(['markdown', 'json']).optional(),
      }),
    },
    async (args) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            synthesizeResults(sessions, inbox, results, {
              session_ids: args.session_ids,
              plan_id: args.plan_id,
              format: args.format,
            })
          ),
        },
      ],
    })
  )
}
