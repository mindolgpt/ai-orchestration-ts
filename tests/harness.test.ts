/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ObsidianVault } from '../src/knowledge/vault'
import { bootstrapHarness } from '../src/harness/bootstrap'
import { buildDomainContextPack, cacheContextPack } from '../src/harness/context-pack'
import { saveDomainProfile } from '../src/harness/profile'
import { projectAgentsMd, cursorRuleMdc } from '../src/harness/templates'
import { runDomainLoop } from '../src/harness/loop'
import type { SemanticSearch } from '../src/knowledge/search'

function mockSearch(
  results: Array<{ path: string; title: string; snippet: string; score: number }> = []
) {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue(results),
    addDocument: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as SemanticSearch
}

describe('harness templates', () => {
  test('projectAgentsMd includes domain', () => {
    const md = projectAgentsMd({
      name: 'shop',
      domain: 'ecommerce',
      description: '쇼핑몰',
      stack: { backend: 'spring-boot', frontend: 'react' },
    })
    expect(md).toContain('ecommerce')
    expect(md).toContain('bootstrap_domain')
    expect(md).toContain('spring-boot')
  })

  test('cursor rule is alwaysApply harness', () => {
    const mdc = cursorRuleMdc({
      name: 'x',
      domain: 'ecommerce',
      description: 'test',
    })
    expect(mdc).toContain('alwaysApply: true')
    expect(mdc).toContain('bootstrap_domain')
  })
})

describe('bootstrapHarness', () => {
  test('creates cursor + shared files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-harness-'))
    const vaultPath = path.join(root, 'vault')
    const vault = new ObsidianVault(vaultPath)
    await vault.initialize()
    await vault.writeNote('wiki/테스트-도메인', '# Test\n\nBounded context rules here.', ['wiki'])

    const result = await bootstrapHarness(vault, {
      projectRoot: root,
      targets: ['cursor', 'claude'],
      force: true,
      profile: {
        domain: 'ecommerce',
        description: '테스트 쇼핑몰',
        stack: { backend: 'spring-boot', frontend: 'react' },
      },
    })

    expect(result.ok).toBe(true)
    expect(await fs.stat(path.join(root, 'AGENTS.md'))).toBeDefined()
    expect(
      await fs.stat(path.join(root, '.cursor', 'rules', 'aio-domain-harness.mdc'))
    ).toBeDefined()
    expect(await fs.stat(path.join(root, '.cursor', 'hooks.json'))).toBeDefined()
    expect(
      await fs.stat(path.join(root, '.cursor', 'hooks', 'aio-session-start.mjs'))
    ).toBeDefined()
    expect(await fs.stat(path.join(root, 'CLAUDE.md'))).toBeDefined()
    expect(await fs.stat(path.join(root, '.aio', 'domain-profile.yaml'))).toBeDefined()
  })

  test('creates per-target rules and hooks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-harness-all-'))
    const vault = new ObsidianVault(path.join(root, 'vault'))
    await vault.initialize()

    const result = await bootstrapHarness(vault, {
      projectRoot: root,
      targets: ['claude', 'windsurf', 'continue', 'codex', 'opencode'],
      force: true,
      profile: { domain: 'ecommerce', description: 'test' },
    })

    expect(result.ok).toBe(true)
    expect(await fs.stat(path.join(root, '.claude', 'settings.json'))).toBeDefined()
    expect(
      await fs.stat(path.join(root, '.claude', 'hooks', 'aio-before-prompt.mjs'))
    ).toBeDefined()
    expect(
      await fs.stat(path.join(root, '.windsurf', 'rules', 'aio-domain-harness.md'))
    ).toBeDefined()
    expect(await fs.stat(path.join(root, '.windsurf', 'hooks.json'))).toBeDefined()
    expect(
      await fs.stat(path.join(root, '.continue', 'rules', 'aio-domain-harness.md'))
    ).toBeDefined()
    expect(await fs.stat(path.join(root, '.continue', 'settings.json'))).toBeDefined()
    expect(await fs.stat(path.join(root, '.codex', 'hooks.json'))).toBeDefined()
    expect(await fs.stat(path.join(root, '.opencode', 'plugins', 'aio-harness.mjs'))).toBeDefined()
  })

  test('does not overwrite existing AGENTS.md without force (including codex)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-harness-agents-'))
    const vault = new ObsidianVault(path.join(root, 'vault'))
    await vault.initialize()
    const sentinel = '# keep-me\n'
    await fs.writeFile(path.join(root, 'AGENTS.md'), sentinel, 'utf-8')

    const result = await bootstrapHarness(vault, {
      projectRoot: root,
      targets: ['codex'],
      force: false,
      profile: { domain: 'ecommerce', description: 'test' },
    })

    expect(result.ok).toBe(true)
    expect(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf-8')).toBe(sentinel)
    const agentsEntry = result.files.find((f) => f.path.endsWith('AGENTS.md'))
    expect(agentsEntry?.action).toBe('skipped')
  })
})

describe('domain context pack', () => {
  test('buildDomainContextPack and cache', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-ctx-'))
    const vaultPath = path.join(root, 'vault')
    const vault = new ObsidianVault(vaultPath)
    await vault.initialize()
    await vault.writeNote('wiki/회원-인증', '# Auth\n\nJWT and refresh tokens.', ['wiki', 'auth'])

    await saveDomainProfile(
      {
        name: 'shop',
        domain: 'ecommerce',
        description: 'shop',
        wiki: { overview_pages: ['회원-인증'], default_top_k: 3 },
      },
      root
    )

    const search = mockSearch()
    const pack = await buildDomainContextPack(vault, search, '로그인 API 만들기', {
      project_root: root,
    })
    expect(pack.pages.length).toBeGreaterThanOrEqual(1)
    expect(pack.harness_prompt).toContain('로그인 API 만들기')

    const cache = await cacheContextPack(pack, root)
    expect(cache).toContain('harness-context.json')
    const raw = await fs.readFile(cache, 'utf-8')
    expect(JSON.parse(raw).task).toBe('로그인 API 만들기')
  })

  test('runDomainLoop returns agent instructions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-loop-'))
    const vaultPath = path.join(root, 'vault')
    const vault = new ObsidianVault(vaultPath)
    await vault.initialize()
    await vault.writeNote('wiki/장바구니', '# Cart\n\nRedis cart.', ['wiki'])

    await saveDomainProfile(
      {
        name: 'shop',
        domain: 'ecommerce',
        description: 'shop',
        wiki: { overview_pages: ['장바구니'] },
      },
      root
    )

    const search = mockSearch()
    const loop = await runDomainLoop(vault, search, '장바구니 API', {
      include_plan: true,
      format: 'markdown',
      project_root: root,
    })
    expect('markdown' in loop && loop.markdown).toContain('Domain loop')
    expect(loop.plan_stub?.title).toBeDefined()
  })
})
