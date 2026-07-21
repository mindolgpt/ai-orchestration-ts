/// <reference types="vitest/globals" />
import { registerKnowledgeTools } from '../src/mcp/tools/knowledge-tools'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SemanticSearch } from '../src/knowledge/search'
import type { ObsidianVault } from '../src/knowledge/vault'

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

function createMockVault() {
  return {
    initialize: vi.fn(),
    writeNote: vi.fn((p: string, content: string) => Promise.resolve(`/vault/${p}.md`)),
    readNote: vi.fn(() => Promise.resolve('# Test\n\nBody')),
    readSchema: vi.fn(() => Promise.resolve('# Schema')),
    listNotes: vi.fn(),
    getTags: vi.fn(),
    searchByTag: vi.fn(),
  } as unknown as ObsidianVault
}

function createMockSearch() {
  return {
    load: vi.fn(),
    save: vi.fn(),
    search: vi.fn(() =>
      Promise.resolve([
        { path: 'wiki/test', title: 'Test', score: 0.95, snippet: 'test content', tags: ['test'] },
      ])
    ),
    addDocument: vi.fn(),
  } as unknown as SemanticSearch
}

describe('registerKnowledgeTools', () => {
  test('registers 2 knowledge tools', () => {
    const { server, tools } = createMockServer()
    registerKnowledgeTools(server, createMockSearch(), createMockVault())
    expect(tools.map((t) => t.name)).toEqual(['recall_knowledge', 'store_knowledge'])
  })

  test('recall_knowledge wraps query_wiki snippets (deprecated)', async () => {
    const { server, getCallback } = createMockServer()
    const mockSearch = createMockSearch()
    registerKnowledgeTools(server, mockSearch, createMockVault())

    const cb = getCallback('recall_knowledge')
    const result = await cb({ query: 'hello', top_k: 3 })

    expect(mockSearch.load).toHaveBeenCalled()
    expect(mockSearch.search).toHaveBeenCalled()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.deprecated).toBe(true)
    expect(parsed.use_instead).toBe('query_wiki')
    expect(parsed.results[0].title).toBe('Test')
  })

  test('store_knowledge calls vault.writeNote and search.addDocument (deprecated)', async () => {
    const { server, getCallback } = createMockServer()
    const mockSearch = createMockSearch()
    const mockVault = createMockVault()
    registerKnowledgeTools(server, mockSearch, mockVault)

    const cb = getCallback('store_knowledge')
    const result = await cb({
      path: 'doc/hello',
      content: '# Hello',
      tags: ['greeting'],
      links: [],
    })

    expect(mockVault.initialize).toHaveBeenCalled()
    expect(mockVault.writeNote).toHaveBeenCalledWith('doc/hello', '# Hello', ['greeting'], [])
    expect(mockSearch.addDocument).toHaveBeenCalled()
    expect(mockSearch.save).toHaveBeenCalled()
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.deprecated).toBe(true)
    expect(parsed.path).toContain('doc/hello')
  })
})
