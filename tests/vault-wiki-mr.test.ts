/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ObsidianVault } from '../src/knowledge/vault'
import { SemanticSearch } from '../src/knowledge/search'
import {
  loadVaultRegistry,
  registerVault,
  listVaultEntries,
  resolveNamedVaultRoot,
} from '../src/knowledge/vault-registry'
import { resolveVaultRoot } from '../src/knowledge/paths'
import { scanRawInbox, rawInboxDir } from '../src/knowledge/raw-inbox'
import {
  proposeWikiChange,
  listWikiProposals,
  applyWikiProposal,
  rejectWikiProposal,
  wikiDiff,
  getWikiProposal,
} from '../src/knowledge/wiki-mr'
import { collectDashboardStats } from '../src/dashboard/server'

function createMockEmbedder() {
  let n = 0
  return {
    dimension: 8,
    embed: async (texts: string[]) =>
      texts.map(() => {
        n += 1
        return Array.from({ length: 8 }, (_, i) => ((n + i) % 7) / 7)
      }),
  }
}

describe('vault registry', () => {
  test('register and resolve named vault', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-vault-reg-'))
    await registerVault({ name: 'main', path: 'vault', domain: 'ecommerce', default: true }, root)
    await registerVault({ name: 'legal', path: 'vault-legal', domain: 'legal' }, root)

    const reg = await loadVaultRegistry(root)
    expect(reg.default).toBe('main')
    expect(Object.keys(reg.vaults)).toContain('legal')

    const entries = await listVaultEntries(root)
    expect(entries.length).toBe(2)

    const resolved = await resolveNamedVaultRoot('legal', root)
    expect(resolved.path).toBe(path.join(root, 'vault-legal'))
  })

  test('resolveVaultRoot uses registry default', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-vault-path-'))
    await fs.mkdir(path.join(root, 'custom-vault'), { recursive: true })
    await registerVault({ name: 'main', path: 'custom-vault', default: true }, root)

    const prev = process.env.AIO_VAULT_PATH
    delete process.env.AIO_VAULT_PATH
    delete process.env.OBSIDIAN_VAULT_PATH

    const prevRoot = process.env.AIO_PROJECT_ROOT
    process.env.AIO_PROJECT_ROOT = root

    expect(resolveVaultRoot()).toBe(path.join(root, 'custom-vault'))

    process.env.AIO_PROJECT_ROOT = prevRoot
    if (prev) process.env.AIO_VAULT_PATH = prev
  })
})

describe('raw inbox', () => {
  test('scanRawInbox ingests dropped file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-inbox-'))
    const vaultDir = path.join(root, 'vault')
    const vault = new ObsidianVault(vaultDir)
    await vault.initialize()
    const search = new SemanticSearch(createMockEmbedder(), path.join(vaultDir, '.index'))

    const inbox = rawInboxDir(vaultDir)
    await fs.mkdir(inbox, { recursive: true })
    await fs.writeFile(
      path.join(inbox, 'policy-note.md'),
      '# Policy\n\nReserve inventory first.\n',
      'utf-8'
    )

    const { processed } = await scanRawInbox(vault, search, {
      project_root: root,
      subdir: 'domain',
      run_lint: false,
    })

    expect(processed.length).toBe(1)
    expect(processed[0].ok).toBe(true)
    expect(processed[0].wiki_pages?.[0]).toContain('wiki/domain/')
  })
})

describe('wiki MR', () => {
  test('propose apply and reject flow', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-wiki-mr-'))
    const vaultDir = path.join(root, 'vault')
    const vault = new ObsidianVault(vaultDir)
    await vault.initialize()
    const search = new SemanticSearch(createMockEmbedder(), path.join(vaultDir, '.index'))

    const diff = await wikiDiff(vault, 'Cart Rules', '# Cart\n\nMax 10 items.\n', 'domain')
    expect(diff.exists).toBe(false)
    expect(diff.diff_lines.some((l) => l.startsWith('+'))).toBe(true)

    const proposal = await proposeWikiChange(
      vault,
      {
        title: 'Cart Rules',
        content: '# Cart\n\nMax 10 items.\n',
        rationale: 'Initial',
        subdir: 'domain',
      },
      root
    )
    expect(proposal.status).toBe('pending')
    expect(proposal.wiki_path).toBe('wiki/domain/cart-rules')

    const pending = await listWikiProposals(root, 'pending')
    expect(pending.some((p) => p.id === proposal.id)).toBe(true)

    const applied = await applyWikiProposal(vault, search, { id: proposal.id }, root)
    expect(applied.proposal.status).toBe('applied')
    expect(await vault.readNote('wiki/domain/cart-rules')).toContain('Max 10 items')

    const rejectProposal = await proposeWikiChange(
      vault,
      { title: 'Reject Me', content: '# Reject\n', subdir: 'domain' },
      root
    )
    const rejected = await rejectWikiProposal(rejectProposal.id, { reason: 'not now' }, root)
    expect(rejected.status).toBe('rejected')
  })

  test('apply update path upserts wiki index', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-wiki-mr-upd-'))
    const vaultDir = path.join(root, 'vault')
    const vault = new ObsidianVault(vaultDir)
    await vault.initialize()
    const search = new SemanticSearch(createMockEmbedder(), path.join(vaultDir, '.index'))

    const created = await proposeWikiChange(
      vault,
      { title: 'Policy', content: '# Policy\nv1\n', subdir: 'domain' },
      root
    )
    await applyWikiProposal(vault, search, { id: created.id }, root)

    const update = await proposeWikiChange(
      vault,
      { title: 'Policy', content: '# Policy\nv2 updated\n', rationale: 'bump', subdir: 'domain' },
      root
    )
    expect(update.previous_content).toBeTruthy()
    await applyWikiProposal(vault, search, { id: update.id }, root)

    const index = await vault.readNote('wiki/index')
    expect(index).toContain('[[domain/policy]]')
    expect(await vault.readNote('wiki/domain/policy')).toContain('v2 updated')
  })

  test('rejects unsafe proposal id', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-wiki-mr-bad-'))
    await expect(getWikiProposal('../evil', root)).rejects.toThrow(/Invalid proposal id/)
  })
})

describe('dashboard stats', () => {
  test('collectDashboardStats returns wiki summary', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-dash-'))
    const vaultDir = path.join(root, 'vault')
    const vault = new ObsidianVault(vaultDir)
    await vault.initialize()

    const stats = await collectDashboardStats(vault, root)
    expect(stats.project_root).toBe(root)
    expect(stats.wiki).toBeDefined()
    expect(stats.proposals.pending).toBeGreaterThanOrEqual(0)
    expect(stats.active_vault).toBeDefined()
    expect(stats.doctor).toBeDefined()
    expect(stats.raw_inbox.failed_files).toBeGreaterThanOrEqual(0)
    expect(stats.commands.scan_inbox).toContain('scan-inbox')
  })
})
