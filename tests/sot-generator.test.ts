/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { generateAndStoreSot } from '@/knowledge/sot-generator'

class FakeEmbedder {
  dimension = 8
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array(8).fill(0)
      v[0] = t.length % 7
      return v
    })
  }
  async embedOne(text: string): Promise<number[]> {
    return (await this.embed([text]))[0]
  }
}

describe('generateAndStoreSot', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-sot-'))
    await fs.mkdir(path.join(tmp, 'src'), { recursive: true })
    await fs.writeFile(
      path.join(tmp, 'src', 'routes.ts'),
      `
export function health() { return { ok: true } }
// GET /health
`,
      'utf-8'
    )
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  test('writes SOT pages under wiki/sot and indexes them', async () => {
    const vaultRoot = path.join(tmp, 'vault')
    const vault = new ObsidianVault(vaultRoot)
    await vault.initialize()
    const search = new SemanticSearch(new FakeEmbedder() as never, {
      indexDir: path.join(vaultRoot, '.index'),
      vaultRoot,
    })

    const result = await generateAndStoreSot(vault, search, {
      projectRoots: [tmp],
      updateIndex: true,
    })

    expect(result.ok).toBe(true)
    expect(result.pages.length).toBeGreaterThan(0)
    expect(result.pages.some((p) => p.includes('wiki/sot'))).toBe(true)

    const sotIndex = await fs.readFile(path.join(vaultRoot, 'wiki', 'sot', 'index.md'), 'utf-8')
    expect(sotIndex).toMatch(/Auto-generated SOT/)

    // wiki/index must not be wiped to only SOT content
    const wikiIndex = await fs.readFile(path.join(vaultRoot, 'wiki', 'index.md'), 'utf-8')
    expect(wikiIndex.length).toBeGreaterThan(0)
  })
})
