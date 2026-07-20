/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ObsidianVault } from '../src/knowledge/vault'
import { SemanticSearch } from '../src/knowledge/search'
import {
  ingestPipeline,
  ingestRawFromOpts,
  ingestSourceBatch,
  readIngestFileContent,
} from '../src/knowledge/wiki-ingest-pipeline'
import { lintWiki } from '../src/knowledge/wiki-ops'
import { pruneForeignHarnessFiles } from '../src/harness/detect-target'
import { bootstrapHarness } from '../src/harness/bootstrap'

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

describe('wiki ingest pipeline', () => {
  test('readIngestFileContent rejects paths outside project root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-ing-safe-'))
    const outside = path.join(os.tmpdir(), `aio-outside-${Date.now()}.md`)
    await fs.writeFile(outside, 'secret', 'utf-8')
    await expect(readIngestFileContent(outside, root)).rejects.toThrow(
      /under project or vault root/
    )
    await fs.unlink(outside).catch(() => {})
  })

  test('readIngestFileContent + ingestPipeline with concepts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-ing-'))
    const vaultDir = path.join(root, 'vault')
    const docPath = path.join(root, 'policy.md')
    await fs.writeFile(
      docPath,
      '# Payment policy\n\nUse reserve-then-confirm for inventory.\n',
      'utf-8'
    )

    const vault = new ObsidianVault(vaultDir)
    await vault.initialize()
    const search = new SemanticSearch(createMockEmbedder(), path.join(vaultDir, '.index'))

    const file = await readIngestFileContent(docPath, root)
    expect(file.content).toContain('Payment policy')

    const result = await ingestPipeline(vault, search, {
      title: 'Payment Policy Source',
      file_path: docPath,
      project_root: root,
      concepts: [
        { title: 'Payment Policy', subdir: 'domain', outline: 'PG and reservation rules' },
        { title: 'Inventory Rules', subdir: 'domain', outline: 'Reserve then confirm' },
      ],
    })

    expect(result.raw.id).toBeDefined()
    expect(result.wiki_pages.length).toBe(2)
    expect(result.wiki_pages[0].wiki_page).toContain('wiki/domain/')

    const lint = await lintWiki(vault, { deep: true })
    expect(lint.raw_count).toBeGreaterThanOrEqual(1)
    expect(lint.taxonomy?.recommended).toContain('domain')
  })

  test('ingestSourceBatch', async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-batch-'))
    const vault = new ObsidianVault(vaultDir)
    await vault.initialize()
    const search = new SemanticSearch(createMockEmbedder(), path.join(vaultDir, '.index'))

    const raw = await ingestRawFromOpts(vault, {
      title: 'Spec',
      content: 'Full spec text',
    })

    const batch = await ingestSourceBatch(vault, search, {
      raw_id: raw.id,
      concepts: [
        { title: 'Concept A', subdir: 'engineering' },
        { title: 'Concept B', subdir: 'engineering' },
      ],
    })

    expect(batch.count).toBe(2)
  })
})

describe('pruneForeignHarnessFiles', () => {
  test('dry_run lists foreign files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-prune-'))
    await fs.mkdir(path.join(root, '.cursor', 'rules'), { recursive: true })
    await fs.writeFile(path.join(root, '.cursor', 'rules', 'x.mdc'), 'x', 'utf-8')
    await fs.writeFile(path.join(root, 'CLAUDE.md'), '# claude', 'utf-8')

    const would = await pruneForeignHarnessFiles(root, 'cursor', { dry_run: true })
    expect(would.some((f) => f.rel === 'CLAUDE.md' && f.action === 'would_delete')).toBe(true)

    const deleted = await pruneForeignHarnessFiles(root, 'cursor')
    expect(deleted.some((f) => f.rel === 'CLAUDE.md' && f.action === 'deleted')).toBe(true)
    await expect(fs.access(path.join(root, 'CLAUDE.md'))).rejects.toThrow()
  })
})
