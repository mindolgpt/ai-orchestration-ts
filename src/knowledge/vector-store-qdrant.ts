import { KnowledgeDoc } from '@/knowledge/types'
import { VectorRecord, VectorSearchHit, VectorStore, vectorPointId } from '@/knowledge/vector-store'
import { asString, docToPayload, payloadToDoc } from '@/knowledge/vector-store-shared'

export interface QdrantVectorStoreOptions {
  url: string
  apiKey?: string
  collection: string
}

/**
 * Remote Qdrant store via REST.
 * Enable with VECTOR_STORE=qdrant and QDRANT_URL=...
 */
export class QdrantVectorStore implements VectorStore {
  readonly kind = 'qdrant' as const
  private dimension = 0
  private ready = false

  constructor(private opts: QdrantVectorStoreOptions) {
    this.opts = {
      ...opts,
      url: opts.url.replace(/\/$/, ''),
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.opts.apiKey) h['api-key'] = this.opts.apiKey
    return h
  }

  private async request(method: string, pathname: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.opts.url}${pathname}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text }
    }
    if (!res.ok) {
      let msg = text.slice(0, 300)
      if (typeof json === 'object' && json && 'status' in json) {
        msg = JSON.stringify(Reflect.get(json, 'status'))
      }
      throw new Error(`Qdrant ${method} ${pathname} failed (${res.status}): ${msg}`)
    }
    return json
  }

  async ensureReady(dimension: number): Promise<void> {
    this.dimension = dimension
    if (this.ready) return

    try {
      await this.request('GET', `/collections/${encodeURIComponent(this.opts.collection)}`)
    } catch {
      await this.request('PUT', `/collections/${encodeURIComponent(this.opts.collection)}`, {
        vectors: {
          size: dimension,
          distance: 'Cosine',
        },
      })
    }
    this.ready = true
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (!records.length) return
    const points = records.map((r) => ({
      id: vectorPointId(r.id),
      vector: r.vector,
      payload: docToPayload(r.document),
    }))
    await this.request(
      'PUT',
      `/collections/${encodeURIComponent(this.opts.collection)}/points?wait=true`,
      { points }
    )
  }

  async replaceAll(records: VectorRecord[]): Promise<void> {
    // Drop + recreate collection to avoid stale points, then upsert all.
    try {
      await this.request('DELETE', `/collections/${encodeURIComponent(this.opts.collection)}`)
    } catch {
      /* missing ok */
    }
    this.ready = false
    await this.ensureReady(this.dimension)
    await this.upsert(records)
  }

  async search(vector: number[], topK: number): Promise<VectorSearchHit[]> {
    const data = (await this.request(
      'POST',
      `/collections/${encodeURIComponent(this.opts.collection)}/points/search`,
      {
        vector,
        limit: topK,
        with_payload: true,
      }
    )) as {
      result?: Array<{ id: string | number; score: number; payload?: Record<string, unknown> }>
    }

    const hits: VectorSearchHit[] = []
    for (const row of data.result || []) {
      if (!row.payload) continue
      const doc = payloadToDoc(row.payload)
      hits.push({
        id: asString(row.payload.path, asString(row.id)),
        score: row.score,
        document: doc,
      })
    }
    return hits
  }

  async count(): Promise<number> {
    const data = (await this.request(
      'GET',
      `/collections/${encodeURIComponent(this.opts.collection)}`
    )) as { result?: { points_count?: number } }
    return data.result?.points_count ?? 0
  }

  async listDocuments(): Promise<KnowledgeDoc[]> {
    const docs: KnowledgeDoc[] = []
    let offset: string | number | null = null
    for (let page = 0; page < 50; page++) {
      const body: Record<string, unknown> = {
        limit: 100,
        with_payload: true,
        with_vector: false,
      }
      if (offset !== null) body.offset = offset
      const data = (await this.request(
        'POST',
        `/collections/${encodeURIComponent(this.opts.collection)}/points/scroll`,
        body
      )) as {
        result?: {
          points?: Array<{ payload?: Record<string, unknown> }>
          next_page_offset?: string | number | null
        }
      }
      const points = data.result?.points || []
      for (const p of points) {
        if (p.payload) docs.push(payloadToDoc(p.payload))
      }
      offset = data.result?.next_page_offset ?? null
      if (offset === null || !points.length) break
    }
    return docs
  }

  async persist(): Promise<void> {
    // Qdrant persists server-side
  }
}
