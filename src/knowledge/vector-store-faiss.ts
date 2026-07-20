import * as fs from 'fs/promises'
import * as path from 'path'
import { KnowledgeDoc } from '@/knowledge/types'
import { FaissIndex, FaissIndexFlatIPCtor, loadFaissIndexFlatIP } from '@/knowledge/faiss'
import { VectorRecord, VectorSearchHit, VectorStore } from '@/knowledge/vector-store'
import { toPosixPath } from '@/knowledge/paths'

function docKey(docPath: string): string {
  return toPosixPath(docPath).replace(/\.md$/, '')
}

/** Local FAISS + meta.json (default offline store). */
export class FaissVectorStore implements VectorStore {
  readonly kind = 'faiss' as const
  private index: FaissIndex | null = null
  private IndexFlatIP: FaissIndexFlatIPCtor | null = null
  private documents: KnowledgeDoc[] = []
  private dimension = 0

  constructor(private indexDir: string) {
    this.indexDir = path.resolve(indexDir)
  }

  async ensureReady(dimension: number): Promise<void> {
    this.dimension = dimension
    if (this.index) return
    this.IndexFlatIP = await loadFaissIndexFlatIP()
    await fs.mkdir(this.indexDir, { recursive: true })

    const indexFile = path.join(this.indexDir, 'index.faiss')
    const metaFile = path.join(this.indexDir, 'meta.json')

    try {
      this.index = this.IndexFlatIP.read(indexFile)
      const meta = JSON.parse(await fs.readFile(metaFile, 'utf-8')) as KnowledgeDoc[]
      this.documents = meta
    } catch {
      this.index = new this.IndexFlatIP(dimension)
      this.documents = []
    }
  }

  /** Append new points only. For path updates, callers use replaceAll. */
  async upsert(records: VectorRecord[]): Promise<void> {
    if (!this.index) throw new Error('FAISS store not ready')
    for (const rec of records) {
      const key = docKey(rec.document.path)
      if (this.documents.some((d) => docKey(d.path) === key)) {
        throw new Error(`FAISS upsert: path already exists (${key}); use replaceAll`)
      }
      this.index.add(new Float32Array(rec.vector))
      this.documents.push(rec.document)
    }
  }

  async replaceAll(records: VectorRecord[]): Promise<void> {
    if (!this.IndexFlatIP) this.IndexFlatIP = await loadFaissIndexFlatIP()
    this.index = new this.IndexFlatIP(this.dimension)
    this.documents = records.map((r) => r.document)
    for (const rec of records) {
      this.index.add(new Float32Array(rec.vector))
    }
  }

  async search(vector: number[], topK: number): Promise<VectorSearchHit[]> {
    if (!this.index || !this.documents.length) return []
    const { distances, indices } = this.index.search(
      new Float32Array(vector),
      Math.min(topK, this.documents.length)
    )
    const hits: VectorSearchHit[] = []
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i]
      if (idx < 0 || idx >= this.documents.length) continue
      const doc = this.documents[idx]
      hits.push({
        id: docKey(doc.path),
        score: distances[i],
        document: doc,
      })
    }
    return hits
  }

  async count(): Promise<number> {
    return this.documents.length
  }

  async listDocuments(): Promise<KnowledgeDoc[]> {
    return [...this.documents]
  }

  async persist(): Promise<void> {
    if (!this.index) return
    await fs.mkdir(this.indexDir, { recursive: true })
    await this.index.write(path.join(this.indexDir, 'index.faiss'))
    await fs.writeFile(
      path.join(this.indexDir, 'meta.json'),
      JSON.stringify(this.documents, null, 2),
      'utf-8'
    )
  }
}
