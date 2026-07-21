/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { MessageInbox } from '../src/mcp/inbox'

describe('MessageInbox', () => {
  test('post and poll', async () => {
    const inbox = new MessageInbox({ backend: 'memory' })
    await inbox.ensureReady()
    inbox.post('sess_1', 'worker-a', 'completed', { result: 'ok' })
    const msgs = inbox.poll()
    expect(msgs.length).toBe(1)
    expect(msgs[0].status).toBe('completed')
  })

  test('unread only', async () => {
    const inbox = new MessageInbox({ backend: 'memory' })
    await inbox.ensureReady()
    inbox.post('sess_1', 'a', 'completed')
    inbox.post('sess_2', 'b', 'failed')
    const first = inbox.poll()
    expect(first.length).toBe(2)
    const second = inbox.poll()
    expect(second.length).toBe(0)
  })

  test('filter by session', async () => {
    const inbox = new MessageInbox({ backend: 'memory' })
    await inbox.ensureReady()
    inbox.post('sess_1', 'a', 'completed')
    inbox.post('sess_2', 'b', 'completed')
    const msgs = inbox.poll('sess_1')
    expect(msgs.length).toBe(1)
    expect(msgs[0].sessionId).toBe('sess_1')
  })

  test('file persistence roundtrip', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-inbox-'))
    const a = new MessageInbox({ backend: 'file', storagePath: dir })
    await a.ensureReady()
    a.post('s1', 'x', 'completed', { summary: 'hi' })
    await a.flush()
    const b = new MessageInbox({ backend: 'file', storagePath: dir })
    await b.ensureReady()
    const msgs = b.peek('s1')
    expect(msgs.length).toBe(1)
    expect(msgs[0].payload.summary).toBe('hi')
  })
})
