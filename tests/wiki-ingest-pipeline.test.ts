/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ObsidianVault } from '../src/knowledge/vault'
import { SemanticSearch } from '../src/knowledge/search'
import {
  buildConceptBody,
  extractSectionFromRaw,
  hasIngestDocumentPayload,
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
      /allowed roots|under project or vault root/
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

  test('extractSectionFromRaw + buildConceptBody expands outline from raw', () => {
    const raw = `# Guide\n\n## Catalog\n\nProduct and Variant rules.\n\n## Order\n\nOrder lifecycle.\n`
    expect(extractSectionFromRaw(raw, 'Catalog')).toContain('Product and Variant')
    const body = buildConceptBody(
      { title: 'Catalog', outline: 'short outline' },
      raw
    )
    expect(body).toContain('Product and Variant')
    expect(body).not.toContain('Expand from raw source')
  })

  test('hasIngestDocumentPayload rejects chat-sized content', () => {
    expect(hasIngestDocumentPayload({ content: 'raw 파일보고 다시' })).toBe(false)
    expect(hasIngestDocumentPayload({ file_path: 'docs/a.md' })).toBe(true)
    expect(hasIngestDocumentPayload({ raw_id: 'a117f128' })).toBe(true)
  })

  test('ingestPipeline refuses chat-only content', async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-refuse-'))
    const vault = new ObsidianVault(vaultDir)
    await vault.initialize()
    const search = new SemanticSearch(createMockEmbedder(), path.join(vaultDir, '.index'))

    await expect(
      ingestPipeline(vault, search, {
        title: 'junk',
        content: 'raw 파일보고 ingest pipeline 다시 해줘',
      })
    ).rejects.toThrow(/substantial content|file_path|raw_id/)
  })

  test('ingestPipeline re-ingests from raw_id without duplicating raw', async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-reingest-'))
    const vault = new ObsidianVault(vaultDir)
    await vault.initialize()
    const search = new SemanticSearch(createMockEmbedder(), path.join(vaultDir, '.index'))

    const rawBody = `# Ecommerce\n\n## Catalog\n\nSKU and assortment details live here.\n\n## Payment\n\nAuthorize then capture.\n`
    const raw = await ingestRawFromOpts(vault, {
      title: 'Ecommerce Domain',
      content: rawBody,
    })

    const first = await ingestPipeline(vault, search, {
      raw_id: raw.id,
      skip_raw: true,
      concepts: [{ title: 'Catalog', subdir: 'domain', outline: 'products' }],
    })
    expect(first.reingest).toBe(true)
    expect(first.raw.id).toBe(raw.id)
    expect(first.wiki_pages[0].wiki_page).toContain('catalog')

    const wiki = await vault.readNote(first.wiki_pages[0].wiki_page)
    expect(wiki).toContain('SKU and assortment')

    const second = await ingestPipeline(vault, search, {
      raw_id: raw.id,
      concepts: [{ title: 'Payment', subdir: 'domain', outline: 'money' }],
    })
    expect(second.raw.id).toBe(raw.id)

    const lint = await lintWiki(vault)
    expect(lint.raw_count).toBe(1)
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
