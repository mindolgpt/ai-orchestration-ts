import * as path from 'path'
import { KnowledgeDoc, SearchResult } from '@/knowledge/types'
import { cosineSimilarity } from '@/knowledge/faiss'
import { toPosixPath } from '@/knowledge/paths'
import { createEmbedder, Embedder } from '@/knowledge/embedder'
import { createVectorStore, resolveVectorStoreKind, VectorStore } from '@/knowledge/vector-store'

function normalizeDocPath(docPath: string): string {
  return toPosixPath(docPath).replace(/\.md$/, '')
}

export interface SemanticSearchOptions {
  indexDir?: string
  vaultRoot?: string
  collectionHint?: string
  store?: VectorStore
}

export class SemanticSearch {
  private store: VectorStore
  private indexDir: string
  private ready = false
  private docsByPath = new Map<string, KnowledgeDoc>()

  constructor(
    private embedder: { embed: (texts: string[]) => Promise<number[][]>; dimension: number },
    indexPathOrOpts: string | SemanticSearchOptions = './vault/.index'
  ) {
    if (typeof indexPathOrOpts === 'string') {
      this.indexDir = path.resolve(indexPathOrOpts)
      this.store = createVectorStore({
        indexDir: this.indexDir,
        vaultRoot: path.dirname(this.indexDir),
      })
    } else {
      this.indexDir = path.resolve(indexPathOrOpts.indexDir || './vault/.index')
      this.store =
        indexPathOrOpts.store ||
        createVectorStore({
          indexDir: this.indexDir,
          vaultRoot: indexPathOrOpts.vaultRoot || path.dirname(this.indexDir),
          collectionHint: indexPathOrOpts.collectionHint,
        })
    }
  }

  get storeKind(): string {
    return this.store.kind
  }

  private async ensureStore(): Promise<void> {
    if (this.ready) return
    await this.store.ensureReady(this.embedder.dimension)
    const docs = await this.store.listDocuments()
    this.docsByPath.clear()
    for (const d of docs) this.docsByPath.set(normalizeDocPath(d.path), d)
    this._cachedCount = docs.length
    this.ready = true
  }

  async addDocument(
    docPath: string,
    title: string,
    content: string,
    tags?: string[]
  ): Promise<void> {
    await this.ensureStore()
    if (!content.trim()) return

    const norm = normalizeDocPath(docPath)
    const prev = this.docsByPath.get(norm)
    const doc: KnowledgeDoc = {
      path: docPath,
      title,
      tags: tags || [],
      links: [],
      content,
      createdAt: prev?.createdAt || new Date().toISOString(),
    }

    if (prev) {
      // Path update: re-embed all docs (FAISS IndexFlatIP has no point delete)
      const next = [...this.docsByPath.values()].map((d) =>
        normalizeDocPath(d.path) === norm ? doc : d
      )
      const embeddings = await this.embedder.embed(next.map((d) => d.content))
      await this.store.replaceAll(
        next.map((d, i) => ({
          id: normalizeDocPath(d.path),
          vector: embeddings[i],
          document: d,
        }))
      )
      this.docsByPath.clear()
      for (const d of next) this.docsByPath.set(normalizeDocPath(d.path), d)
      this._cachedCount = next.length
      return
    }

    const emb = await this.embedder.embed([content])
    await this.store.upsert([{ id: norm, vector: emb[0], document: doc }])
    this.docsByPath.set(norm, doc)
    this._cachedCount = this.docsByPath.size
  }

  /** Exposed for tests — number of indexed documents (after dedupe). */
  get documentCount(): number {
    // Sync getter: prefer last-known via blocking not possible; tests call after await ops.
    // Use cached sync snapshot updated in ensure — fall back to 0 until loaded.
    return this._cachedCount
  }

  private _cachedCount = 0

  private async refreshCount(): Promise<void> {
    this._cachedCount = await this.store.count()
  }

  async search(query: string, topK: number = 10): Promise<SearchResult[]> {
    await this.ensureStore()
    await this.refreshCount()
    if (this._cachedCount === 0) return []

    const qEmb = await this.embedder.embed([query])
    const qVec = qEmb[0]

    try {
      const hits = await this.store.search(qVec, topK)
      await this.refreshCount()
      return hits.map((h) => ({
        path: h.document.path,
        title: h.document.title,
        score: h.score,
        snippet: h.document.content.slice(0, 200),
        tags: h.document.tags,
      }))
    } catch {
      // Cosine fallback over listed documents (offline / store errors)
      const docs = await this.store.listDocuments()
      const results: SearchResult[] = []
      for (const doc of docs) {
        const docEmb = await this.embedder.embed([doc.content])
        const score = cosineSimilarity(new Float32Array(qVec), new Float32Array(docEmb[0]))
        results.push({
          path: doc.path,
          title: doc.title,
          score,
          snippet: doc.content.slice(0, 200),
          tags: doc.tags,
        })
      }
      results.sort((a, b) => b.score - a.score)
      return results.slice(0, topK)
    }
  }

  async save(): Promise<void> {
    await this.ensureStore()
    try {
      await this.store.persist()
      await this.refreshCount()
    } catch (err) {
      console.error('Failed to save index:', err)
      throw err
    }
  }

  async load(): Promise<void> {
    await this.ensureStore()
    await this.refreshCount()
  }
}

/** Factory: local FAISS by default; set VECTOR_STORE=qdrant (+ QDRANT_URL) for remote. */
export function createSemanticSearch(
  vaultRoot: string,
  embedder?: Embedder,
  opts?: { collectionHint?: string }
): SemanticSearch {
  const indexDir = path.join(path.resolve(vaultRoot), '.index')
  return new SemanticSearch(embedder || createEmbedder(), {
    indexDir,
    vaultRoot: path.resolve(vaultRoot),
    collectionHint: opts?.collectionHint,
  })
}

export { resolveVectorStoreKind }
