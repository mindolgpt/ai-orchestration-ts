import { KnowledgeDoc } from '@/knowledge/types'
import { VectorRecord, VectorSearchHit, VectorStore, vectorPointId } from '@/knowledge/vector-store'
import { asString, docToPayload, httpJson, payloadToDoc } from '@/knowledge/vector-store-shared'

export interface ChromaVectorStoreOptions {
  url: string
  collection: string
  tenant?: string
  database?: string
  apiKey?: string
}

/**
 * Chroma HTTP API (v1 + v2).
 * VECTOR_STORE=chroma  CHROMA_URL=http://127.0.0.1:8000
 */
export class ChromaVectorStore implements VectorStore {
  readonly kind = 'chroma' as const
  private dimension = 0
  private ready = false
  private collectionId: string | null = null
  private api: 'v1' | 'v2' = 'v2'

  constructor(private opts: ChromaVectorStoreOptions) {
    this.opts = {
      tenant: 'default_tenant',
      database: 'default_database',
      ...opts,
      url: opts.url.replace(/\/$/, ''),
    }
    const ver = (process.env.CHROMA_API || '').trim().toLowerCase()
    if (ver === 'v1') this.api = 'v1'
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {}
    if (this.opts.apiKey) {
      h['X-Chroma-Token'] = this.opts.apiKey
      h.Authorization = `Bearer ${this.opts.apiKey}`
    }
    return h
  }

  private v2Base(): string {
    const t = encodeURIComponent(this.opts.tenant || 'default_tenant')
    const d = encodeURIComponent(this.opts.database || 'default_database')
    return `${this.opts.url}/api/v2/tenants/${t}/databases/${d}`
  }

  async ensureReady(dimension: number): Promise<void> {
    this.dimension = dimension
    if (this.ready) return

    if (this.api !== 'v1') {
      try {
        await this.ensureReadyV2()
        this.ready = true
        return
      } catch {
        this.api = 'v1'
      }
    }
    await this.ensureReadyV1()
    this.ready = true
  }

  private async ensureReadyV2(): Promise<void> {
    const base = this.v2Base()
    try {
      const list = (await httpJson(`${base}/collections`, {
        headers: this.headers(),
        label: 'Chroma',
      })) as Array<{ id?: string; name?: string }>
      const found = (Array.isArray(list) ? list : []).find((c) => c.name === this.opts.collection)
      if (found?.id) {
        this.collectionId = found.id
        return
      }
    } catch {
      /* create below */
    }
    const created = (await httpJson(`${base}/collections`, {
      method: 'POST',
      headers: this.headers(),
      label: 'Chroma',
      body: {
        name: this.opts.collection,
        get_or_create: true,
        metadata: { 'hnsw:space': 'cosine', aio_dimension: dimensionString(this.dimension) },
      },
    })) as { id?: string }
    this.collectionId = created.id || this.opts.collection
  }

  private async ensureReadyV1(): Promise<void> {
    const base = `${this.opts.url}/api/v1`
    try {
      const col = (await httpJson(
        `${base}/collections/${encodeURIComponent(this.opts.collection)}`,
        { headers: this.headers(), label: 'Chroma' }
      )) as { id?: string }
      this.collectionId = col.id || this.opts.collection
      return
    } catch {
      /* create */
    }
    const created = (await httpJson(`${base}/collections`, {
      method: 'POST',
      headers: this.headers(),
      label: 'Chroma',
      body: {
        name: this.opts.collection,
        get_or_create: true,
        metadata: { 'hnsw:space': 'cosine' },
      },
    })) as { id?: string }
    this.collectionId = created.id || this.opts.collection
  }

  private collectionPath(suffix: string): string {
    if (this.api === 'v2') {
      return `${this.v2Base()}/collections/${encodeURIComponent(this.collectionId || this.opts.collection)}${suffix}`
    }
    return `${this.opts.url}/api/v1/collections/${encodeURIComponent(this.collectionId || this.opts.collection)}${suffix}`
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (!records.length) return
    const ids = records.map((r) => vectorPointId(r.id))
    const embeddings = records.map((r) => r.vector)
    const documents = records.map((r) => r.document.content)
    const metadatas = records.map((r) => docToPayload(r.document))
    await httpJson(this.collectionPath('/upsert'), {
      method: 'POST',
      headers: this.headers(),
      label: 'Chroma',
      body: { ids, embeddings, documents, metadatas },
    })
  }

  async replaceAll(records: VectorRecord[]): Promise<void> {
    if (this.api === 'v2') {
      try {
        await httpJson(
          `${this.v2Base()}/collections/${encodeURIComponent(this.collectionId || this.opts.collection)}`,
          { method: 'DELETE', headers: this.headers(), label: 'Chroma' }
        )
      } catch {
        /* ok */
      }
    } else {
      try {
        await httpJson(
          `${this.opts.url}/api/v1/collections/${encodeURIComponent(this.opts.collection)}`,
          { method: 'DELETE', headers: this.headers(), label: 'Chroma' }
        )
      } catch {
        /* ok */
      }
    }
    this.ready = false
    this.collectionId = null
    await this.ensureReady(this.dimension)
    await this.upsert(records)
  }

  async search(vector: number[], topK: number): Promise<VectorSearchHit[]> {
    const data = (await httpJson(this.collectionPath('/query'), {
      method: 'POST',
      headers: this.headers(),
      label: 'Chroma',
      body: {
        query_embeddings: [vector],
        n_results: topK,
        include: ['metadatas', 'distances', 'documents'],
      },
    })) as {
      ids?: string[][]
      distances?: number[][]
      metadatas?: Array<Array<Record<string, unknown> | null>>
    }
    const ids = data.ids?.[0] || []
    const distances = data.distances?.[0] || []
    const metadatas = data.metadatas?.[0] || []
    const hits: VectorSearchHit[] = []
    for (let i = 0; i < ids.length; i++) {
      const meta = metadatas[i]
      if (!meta) continue
      const doc = payloadToDoc(meta)
      // Chroma cosine distance → similarity-ish score
      const dist = distances[i] ?? 1
      hits.push({ id: asString(meta.path, asString(ids[i])), score: 1 - dist, document: doc })
    }
    return hits
  }

  async count(): Promise<number> {
    const data = (await httpJson(this.collectionPath('/count'), {
      method: this.api === 'v2' ? 'GET' : 'GET',
      headers: this.headers(),
      label: 'Chroma',
    })) as number | { count?: number }
    if (typeof data === 'number') return data
    return data.count ?? 0
  }

  async listDocuments(): Promise<KnowledgeDoc[]> {
    const data = (await httpJson(this.collectionPath('/get'), {
      method: 'POST',
      headers: this.headers(),
      label: 'Chroma',
      body: { include: ['metadatas'] },
    })) as { metadatas?: Array<Record<string, unknown> | null> }
    return (data.metadatas || [])
      .filter(Boolean)
      .map((m) => payloadToDoc(m as Record<string, unknown>))
  }

  async persist(): Promise<void> {}
}

function dimensionString(n: number): string {
  return String(n)
}
