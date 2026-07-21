/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ObsidianVault } from '../src/knowledge/vault'
import { brainstormDesign } from '../src/harness/brainstorm'
import { detectFocusFromTopic } from '../src/harness/brainstorm-focus'
import { saveDomainProfile } from '../src/harness/profile'
import type { SemanticSearch } from '../src/knowledge/search'

function mockSearch() {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    addDocument: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as SemanticSearch
}

describe('detectFocusFromTopic', () => {
  test('detects planning and ux', () => {
    const f = detectFocusFromTopic('체크아웃 기획과 UX 플로우')
    expect(f).toContain('planning')
    expect(f).toContain('ux')
  })

  test('detects visual design', () => {
    const f = detectFocusFromTopic('디자인 시스템 shadcn')
    expect(f).toContain('visual_design')
  })

  test('broad dev topic gets multiple lenses', () => {
    const f = detectFocusFromTopic('쇼핑몰 기능 개발')
    expect(f.length).toBeGreaterThanOrEqual(3)
  })
})

describe('brainstormDesign full lifecycle', () => {
  test('phase alone keeps status questions and drops answered ids', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-brain-phase-'))
    const vault = new ObsidianVault(path.join(root, 'vault'))
    await vault.initialize()

    const r = await brainstormDesign(vault, mockSearch(), '위키 기반 ecommerce 개발', {
      project_root: root,
      answers: { phase: 'design' },
      write_docs: false,
    })

    expect(r.status).toBe('questions')
    expect(r.clarifying_questions.some((q) => q.id === 'phase')).toBe(false)
    expect(r.clarifying_questions.some((q) => q.id === 'scale')).toBe(true)
    expect(r.agent_instructions).toContain('same topic')
  })

  test('scale+phase returns brief', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-brain-ready-'))
    const vault = new ObsidianVault(path.join(root, 'vault'))
    await vault.initialize()

    const r = await brainstormDesign(vault, mockSearch(), '위키 기반 ecommerce 개발', {
      project_root: root,
      answers: { phase: 'design', scale: 'mvp' },
      write_docs: false,
    })

    expect(r.status).toBe('brief')
    expect(r.options.length).toBeGreaterThan(0)
  })

  test('returns lenses and planning options', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-brain-full-'))
    const vault = new ObsidianVault(path.join(root, 'vault'))
    await vault.initialize()

    const r = await brainstormDesign(vault, mockSearch(), '체크아웃 기획 UX 디자인', {
      project_root: root,
      skip_questions: true,
      answers: { scale: 'mvp', phase: 'discovery' },
    })

    expect(r.status).toBe('brief')
    expect(r.development_lenses.length).toBeGreaterThanOrEqual(10)
    expect(r.detected_focus).toContain('planning')
    expect(r.options.some((o) => o.focus === 'planning' || o.focus === 'ux')).toBe(true)
    expect(r.agent_instructions).toContain('기획')
    expect(r.agent_instructions).toContain('UX')
  })

  test('Cart MVP marks domain/ux lenses from BC pattern', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-brain-cart-mvp-'))
    const vault = new ObsidianVault(path.join(root, 'vault'))
    await vault.initialize()

    const r = await brainstormDesign(vault, mockSearch(), 'Cart MVP', {
      project_root: root,
      answers: { scale: 'mvp', phase: 'design' },
      write_docs: false,
    })

    expect(r.detected_focus).toContain('domain')
    expect(r.detected_focus).toContain('ux')
    expect(r.development_lenses.find((l) => l.focus === 'domain')?.relevant).toBe(true)
    expect(r.options.some((o) => o.focus === 'domain' || o.focus === 'database')).toBe(true)
  })

  test('cart topic includes domain + ux', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-brain-cart-'))
    const vaultPath = path.join(root, 'vault')
    const vault = new ObsidianVault(vaultPath)
    await vault.initialize()
    await vault.writeNote('wiki/장바구니', '# Cart\n\nRedis.', ['wiki'])

    await saveDomainProfile(
      { name: 's', domain: 'e', description: 'd', wiki: { overview_pages: ['장바구니'] } },
      root
    )

    const r = await brainstormDesign(vault, mockSearch(), '장바구니 기능 개발', {
      project_root: root,
      skip_questions: true,
      answers: { scale: 'mvp', phase: 'build' },
    })

    expect(r.options.length).toBeGreaterThan(0)
    expect(r.development_lenses.filter((l) => l.relevant).length).toBeGreaterThan(0)
  })
})
