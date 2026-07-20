/// <reference types="vitest/globals" />
import { resolveSessionSpawn, listSessionRuntimes } from '../src/mcp/session-runtime'

describe('session-runtime', () => {
  const prev = { ...process.env }

  afterEach(() => {
    process.env = { ...prev }
  })

  test('defaults to opencode run', () => {
    delete process.env.AIO_SESSION_RUNTIME
    delete process.env.AIO_SESSION_COMMAND
    delete process.env.AIO_SESSION_ARGS
    const spec = resolveSessionSpawn('hello world')
    expect(spec.runtime).toBe('opencode')
    expect(spec.command).toBe('opencode')
    expect(spec.args).toEqual(['run', 'hello world'])
  })

  test('claude runtime', () => {
    const spec = resolveSessionSpawn('do it', { runtime: 'claude' })
    expect(spec.command).toBe('claude')
    expect(spec.args).toEqual(['-p', 'do it'])
  })

  test('custom args with placeholder', () => {
    process.env.AIO_SESSION_RUNTIME = 'custom'
    process.env.AIO_SESSION_COMMAND = 'mycli'
    process.env.AIO_SESSION_ARGS = JSON.stringify(['exec', '{{prompt}}', '--quiet'])
    const spec = resolveSessionSpawn('TASK')
    expect(spec).toEqual({
      runtime: 'custom',
      command: 'mycli',
      args: ['exec', 'TASK', '--quiet'],
    })
  })

  test('lists known runtimes', () => {
    expect(listSessionRuntimes().map((r) => r.id)).toContain('cursor')
  })
})
