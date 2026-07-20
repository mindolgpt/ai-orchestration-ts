/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  detectHarnessTargetFromEnv,
  detectHarnessTargetFromProject,
  resolveTargetsAsync,
  findForeignHarnessFiles,
} from '../src/harness/detect-target'
import { bootstrapHarness } from '../src/harness/bootstrap'
import { ObsidianVault } from '../src/knowledge/vault'

describe('detectHarnessTargetFromEnv', () => {
  const orig = { ...process.env }

  afterEach(() => {
    process.env = { ...orig }
  })

  test('AIO_HARNESS_TARGET explicit', () => {
    process.env.AIO_HARNESS_TARGET = 'claude'
    expect(detectHarnessTargetFromEnv()?.target).toBe('claude')
  })

  test('CURSOR_PROJECT_DIR → cursor', () => {
    delete process.env.AIO_HARNESS_TARGET
    process.env.CURSOR_PROJECT_DIR = 'D:/proj'
    expect(detectHarnessTargetFromEnv()?.target).toBe('cursor')
  })
})

describe('detectHarnessTargetFromProject', () => {
  test('scores cursor when .cursor files exist', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-det-'))
    await fs.mkdir(path.join(root, '.cursor', 'rules'), { recursive: true })
    await fs.writeFile(path.join(root, '.cursor', 'rules', 'aio-domain-harness.mdc'), 'x')
    await fs.writeFile(
      path.join(root, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'aio-mcp': { args: ['@mindol1004/aio-mcp'] } } }),
      'utf-8'
    )

    const d = await detectHarnessTargetFromProject(root)
    expect(d?.target).toBe('cursor')
  })
})

describe('resolveTargetsAsync', () => {
  test('defaults to single target not all', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-res-'))
    await fs.mkdir(path.join(root, '.cursor', 'hooks'), { recursive: true })
    await fs.writeFile(path.join(root, '.cursor', 'hooks.json'), '{}', 'utf-8')

    const { targets } = await resolveTargetsAsync(undefined, root)
    expect(targets.length).toBe(1)
    expect(targets).not.toContain('claude')
  })

  test('all still works when explicit', async () => {
    const { targets } = await resolveTargetsAsync(['all'], '/tmp')
    expect(targets.length).toBe(6)
  })
})

describe('findForeignHarnessFiles', () => {
  test('lists claude files when active is cursor', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-for-'))
    await fs.writeFile(path.join(root, 'CLAUDE.md'), '# claude', 'utf-8')
    await fs.writeFile(path.join(root, 'opencode.json'), '{}', 'utf-8')
    await fs.mkdir(path.join(root, '.cursor', 'rules'), { recursive: true })
    await fs.writeFile(path.join(root, '.cursor', 'rules', 'x.mdc'), 'x', 'utf-8')

    const foreign = await findForeignHarnessFiles(root, 'cursor')
    expect(foreign.some((f) => f.rel === 'CLAUDE.md')).toBe(true)
    expect(foreign.some((f) => f.rel === 'opencode.json')).toBe(true)
    expect(foreign.every((f) => f.target !== 'cursor')).toBe(true)
  })
})

describe('bootstrapHarness auto-detect', () => {
  test('creates only cursor files when CURSOR env set', async () => {
    const orig = process.env.CURSOR_PROJECT_DIR
    process.env.CURSOR_PROJECT_DIR = 'D:/fake'

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-boot1-'))
    const vault = new ObsidianVault(path.join(root, 'vault'))
    await vault.initialize()

    const result = await bootstrapHarness(vault, {
      projectRoot: root,
      force: true,
    })

    expect(result.targets).toEqual(['cursor'])
    expect(await fs.stat(path.join(root, '.cursor', 'hooks.json'))).toBeDefined()
    await expect(fs.stat(path.join(root, 'CLAUDE.md'))).rejects.toThrow()

    if (orig === undefined) delete process.env.CURSOR_PROJECT_DIR
    else process.env.CURSOR_PROJECT_DIR = orig
  })
})
