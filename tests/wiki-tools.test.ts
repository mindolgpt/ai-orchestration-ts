/// <reference types="vitest/globals" />
import { ObsidianVault } from '../src/knowledge/vault'
import { SemanticSearch } from '../src/knowledge/search'
import {
  fileBack,
  getWikiSchema,
  ingestRaw,
  ingestSource,
  lintWiki,
  queryWiki,
  updateWikiPage,
} from '../src/knowledge/wiki-ops'
import { registerWikiTools } from '../src/mcp/tools/wiki-tools'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

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

function createMockServer() {
  const tools: Array<{ name: string; callback: Function }> = []
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, callback: Function) => {
      tools.push({ name, callback })
    }),
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

describe('wiki-ops 3-layer flow', () => {
  let vault: ObsidianVault
  let search: SemanticSearch

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aio-wiki-'))
    vault = new ObsidianVault(dir)
    search = new SemanticSearch(createMockEmbedder(), join(dir, '.index'))
    await vault.initialize()
  })

  test('getWikiSchema returns seeded schema', async () => {
    const schema = await getWikiSchema(vault)
    expect(schema.path).toBe('AGENTS.md')
    expect(schema.content).toContain('disciplined wiki maintainer')
  })

  test('ingest_raw → ingest_source → query → file_back → lint', async () => {
    const raw = await ingestRaw(vault, {
      title: 'Checkout Spec',
      content: 'Checkout uses saga with inventory reservation.',
      source_uri: 'https://example.com/spec',
    })

    const page = await ingestSource(vault, search, {
      title: 'Checkout Saga',
      content: '# Checkout Saga\n\nReserve inventory then pay.\n\nRelated: inventory.',
      raw_id: raw.id,
      tags: ['ecommerce'],
      summary: 'Saga coordinates checkout',
    })
    expect(page.wiki_page).toBe('wiki/checkout-saga')

    await updateWikiPage(vault, search, {
      title: 'Checkout Saga',
      content: '# Checkout Saga\n\nReserve inventory then pay. Updated.\n\n- [[Inventory]]',
      summary: 'Saga with inventory link',
    })

    // second page so first is not orphan via inbound... actually Inventory doesn't exist
    await ingestSource(vault, search, {
      title: 'Inventory',
      content: '# Inventory\n\nSoft/hard reservation.\n\n- [[Checkout Saga]]',
      tags: ['ecommerce'],
    })

    const q = await queryWiki(vault, search, 'checkout saga', 5)
    expect(q.citations.length).toBeGreaterThan(0)
    expect(q.reminder).toContain('file_back')

    const fb = await fileBack(vault, search, {
      title: 'Checkout FAQ',
      content: 'Checkout reserves stock before payment.',
      query: 'how does checkout work',
      citations: ['Checkout Saga', 'Inventory'],
    })
    expect(fb.wiki_page).toBe('wiki/checkout-faq')

    const index = await vault.readNote('wiki/index')
    expect(index).toContain('[[checkout-saga]]')
    expect((index!.match(/^---$/gm) || []).length).toBe(2)

    const log = await vault.readNote('wiki/log')
    expect(log).toContain('ingest_raw')
    expect(log).toContain('file_back')

    const lint = await lintWiki(vault)
    expect(lint.schema_present).toBe(true)
    expect(lint.raw_count).toBeGreaterThanOrEqual(1)
    expect(lint.total_wiki_pages).toBeGreaterThanOrEqual(2)
  })

  test('updateWikiPage finds subdir pages; lint resolves taxonomy links', async () => {
    await ingestSource(vault, search, {
      title: 'Cart Rules',
      content: '# Cart Rules\n\nMax items.\n',
      subdir: 'domain',
    })
    await ingestSource(vault, search, {
      title: 'Checkout',
      content: '# Checkout\n\nSee [[domain/cart-rules]] and [[Cart Rules]].\n',
      subdir: 'domain',
    })

    const updated = await updateWikiPage(vault, search, {
      title: 'Cart Rules',
      content: '# Cart Rules\n\nMax 20 items.\n',
      subdir: 'domain',
    })
    expect(updated.wiki_page).toBe('wiki/domain/cart-rules')
    expect(await vault.readNote('wiki/domain/cart-rules')).toContain('Max 20 items')

    // bare title should also resolve via basename lookup
    await updateWikiPage(vault, search, {
      title: 'Cart Rules',
      content: '# Cart Rules\n\nMax 30 items.\n',
    })
    expect(await vault.readNote('wiki/domain/cart-rules')).toContain('Max 30 items')

    const lint = await lintWiki(vault, { deep: true })
    const brokenToCart = lint.deep?.broken_links.filter((b) =>
      /cart-rules|Cart Rules/i.test(b.target)
    )
    expect(brokenToCart?.length ?? 0).toBe(0)
  })

  test('addDocument upserts by path', async () => {
    await search.addDocument('wiki/dup', 'Dup', 'version one content here')
    await search.addDocument('wiki/dup', 'Dup', 'version two content here')
    expect(search.documentCount).toBe(1)
  })
})

describe('registerWikiTools', () => {
  test('registers full wiki tool set', () => {
    const { server, tools } = createMockServer()
    const dir = mkdtempSync(join(tmpdir(), 'aio-tools-'))
    const vault = new ObsidianVault(dir)
    const search = new SemanticSearch(createMockEmbedder(), join(dir, '.index'))
    registerWikiTools(server, vault, search)
    expect(tools.map((t) => t.name)).toEqual([
      'get_wiki_schema',
      'ingest_raw',
      'ingest_source',
      'ingest_source_batch',
      'ingest_pipeline',
      'update_wiki_page',
      'query_wiki',
      'file_back',
      'lint_wiki',
      'propose_wiki_change',
      'list_wiki_proposals',
      'apply_wiki_proposal',
      'reject_wiki_proposal',
      'wiki_diff',
    ])
  })

  test('get_wiki_schema tool works', async () => {
    const { server, getCallback } = createMockServer()
    const dir = mkdtempSync(join(tmpdir(), 'aio-tools2-'))
    const vault = new ObsidianVault(dir)
    const search = new SemanticSearch(createMockEmbedder(), join(dir, '.index'))
    registerWikiTools(server, vault, search)
    const result = await getCallback('get_wiki_schema')({})
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.content).toContain('3 Layers')
  })
})
