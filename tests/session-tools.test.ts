/// <reference types="vitest/globals" />
import { MessageInbox } from '../src/mcp/inbox'

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    spawn: vi.fn(),
  }
})

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => '00000000-0000-0000-0000-000000000001'),
  randomBytes: vi.fn(() => Buffer.from('0123456789abcdef0123456789abcdef', 'hex')),
}))

import {
  spawnSession,
  waitForSession,
  closeSession,
  registerSessionTools,
  ChildSession,
} from '../src/mcp/tools/session-tools'
import { spawn } from 'child_process'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

function createMockServer() {
  const tools: Array<{ name: string; callback: Function }> = []
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, callback: Function) => {
      tools.push({ name, callback })
    }),
    connect: vi.fn(),
  }
  return {
    server: server as unknown as McpServer,
    tools,
    getCallback: (name: string) => {
      const t = tools.find((x) => x.name === name)
      if (!t) throw new Error(`Tool '${name}' not registered`)
      return t.callback
    },
  }
}

function makeMockProc() {
  const closeHandlers: Array<(code: number | null) => void> = []
  return {
    pid: 12345,
    killed: false,
    kill: vi.fn(function (this: { killed: boolean }) {
      this.killed = true
    }),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, handler: (code: number | null) => void) => {
      if (event === 'close') closeHandlers.push(handler)
    }),
    triggerClose: (code: number) => closeHandlers.forEach((h) => h(code)),
  }
}

function emptySession(
  partial: Partial<ChildSession> & Pick<ChildSession, 'id' | 'status'>
): ChildSession {
  return {
    task: '',
    createdAt: 0,
    stdout: '',
    stderr: '',
    pendingMessages: [],
    ...partial,
  }
}

describe('spawnSession', () => {
  let sessions: Map<string, ChildSession>
  let inbox: MessageInbox
  let mockProc: ReturnType<typeof makeMockProc>

  beforeEach(() => {
    sessions = new Map()
    inbox = new MessageInbox({ backend: 'memory' })
    mockProc = makeMockProc()
    vi.mocked(spawn).mockReturnValue(mockProc as never)
    vi.clearAllMocks()
  })

  test('creates a session and injects session_id into prompt', async () => {
    const result = await spawnSession(sessions, inbox, 5, 'do something', 'context')

    expect(spawn).toHaveBeenCalledWith(
      'opencode',
      ['run', expect.stringContaining('[Session ID]')],
      expect.objectContaining({
        env: expect.objectContaining({
          AIO_SESSION_ID: 'sess_00000000',
          AIO_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
        }),
      })
    )
    expect(result).toMatchObject({
      session_id: 'sess_00000000',
      pid: 12345,
      status: 'running',
      isolated: true,
    })
    expect(sessions.size).toBe(1)
  })

  test('rejects when max running sessions reached', async () => {
    sessions.set('existing', emptySession({ id: 'existing', status: 'running' }))
    const result = await spawnSession(sessions, inbox, 1, 'task')
    expect(spawn).not.toHaveBeenCalled()
    expect(result).toMatchObject({ error: 'Max running sessions exceeded (1)' })
  })

  test('completed sessions do not count toward max', async () => {
    sessions.set('done', emptySession({ id: 'done', status: 'completed' }))
    const result = await spawnSession(sessions, inbox, 1, 'task')
    expect(result.session_id).toBe('sess_00000000')
  })

  test('updates session status on process close (exit 0)', async () => {
    await spawnSession(sessions, inbox, 5, 'task')
    mockProc.triggerClose(0)
    const s = sessions.get('sess_00000000')
    expect(s?.status).toBe('completed')
    const msgs = inbox.poll()
    expect(msgs.length).toBe(1)
    expect(msgs[0].status).toBe('completed')
  })

  test('marks session failed on non-zero exit', async () => {
    await spawnSession(sessions, inbox, 5, 'task')
    mockProc.triggerClose(1)
    const s = sessions.get('sess_00000000')
    expect(s?.status).toBe('failed')
  })
})

describe('waitForSession', () => {
  let sessions: Map<string, ChildSession>
  let inbox: MessageInbox

  beforeEach(() => {
    sessions = new Map()
    inbox = new MessageInbox({ backend: 'memory' })
  })

  test('returns completed status when session finishes', async () => {
    sessions.set('sess_1', emptySession({ id: 'sess_1', status: 'completed' }))
    inbox.post('sess_1', 'test', 'completed', { summary: 'all good' })

    const result = await waitForSession(sessions, inbox, 'sess_1', 5000)
    expect(result.status).toBe('completed')
    expect(result.result).toBe('all good')
  })

  test('kills process and returns timeout', async () => {
    const proc = makeMockProc()
    sessions.set(
      'sess_slow',
      emptySession({ id: 'sess_slow', status: 'running', proc: proc as never })
    )

    const result = await waitForSession(sessions, inbox, 'sess_slow', 100)
    expect(result.status).toBe('timeout')
    expect(sessions.get('sess_slow')?.status).toBe('timeout')
  })
})

describe('closeSession', () => {
  test('kills running process', async () => {
    const sessions = new Map<string, ChildSession>()
    const proc = makeMockProc()
    sessions.set('s1', emptySession({ id: 's1', status: 'running', proc: proc as never }))
    const result = await closeSession(sessions, 's1', true)
    expect(result).toMatchObject({ closed: true, killed: true })
    expect(sessions.has('s1')).toBe(false)
  })
})

describe('registerSessionTools', () => {
  test('registers 8 session tools', () => {
    const { server, tools } = createMockServer()
    registerSessionTools(server, new Map(), new MessageInbox({ backend: 'memory' }), 5)

    const names = tools.map((t) => t.name)
    expect(names).toEqual([
      'spawn_session',
      'check_inbox',
      'report_result',
      'send_message',
      'get_session',
      'close_session',
      'list_sessions',
      'synthesize_results',
    ])
  })

  test('send_message queues pending_messages', async () => {
    const { server, getCallback } = createMockServer()
    const sessions = new Map<string, ChildSession>()
    const inbox = new MessageInbox({ backend: 'memory' })
    sessions.set('s1', emptySession({ id: 's1', status: 'running' }))
    registerSessionTools(server, sessions, inbox, 5)

    const cb = getCallback('send_message')
    const result = await cb({ session_id: 's1', message: 'ping' })
    expect(JSON.parse(result.content[0].text)).toMatchObject({ queued: true, pending_count: 1 })
    expect(sessions.get('s1')?.pendingMessages).toEqual(['ping'])
  })

  test('report_result requires session_secret when session has secret', async () => {
    const { server, getCallback } = createMockServer()
    const sessions = new Map<string, ChildSession>()
    const inbox = new MessageInbox({ backend: 'memory' })
    sessions.set('s1', emptySession({ id: 's1', status: 'running', sessionSecret: 'sec123' }))
    registerSessionTools(server, sessions, inbox, 5)

    const cb = getCallback('report_result')
    const denied = await cb({
      session_id: 's1',
      status: 'completed',
      summary: 'done',
    })
    expect(JSON.parse(denied.content[0].text)).toMatchObject({
      error: expect.stringContaining('session_secret'),
    })

    const ok = await cb({
      session_id: 's1',
      status: 'completed',
      summary: 'done',
      session_secret: 'sec123',
    })
    expect(JSON.parse(ok.content[0].text)).toMatchObject({ posted: true })
  })

  test('spawn_session callback calls spawnSession', async () => {
    const { server, getCallback } = createMockServer()
    const sessions = new Map<string, ChildSession>()
    const inbox = new MessageInbox({ backend: 'memory' })

    const mockProc2 = makeMockProc()
    vi.mocked(spawn).mockReturnValue(mockProc2 as never)

    registerSessionTools(server, sessions, inbox, 5)
    const cb = getCallback('spawn_session')
    const result = await cb({ task: 'test task', context: 'ctx' })

    expect(spawn).toHaveBeenCalled()
    expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'running' })
  })
})
