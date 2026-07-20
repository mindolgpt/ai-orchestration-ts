import { KnowledgeDoc } from '@/knowledge/types'
import { VectorRecord, VectorSearchHit, VectorStore, vectorPointId } from '@/knowledge/vector-store'
import {
  asString,
  asStringArray,
  docToPayload,
  httpJson,
  payloadToDoc,
} from '@/knowledge/vector-store-shared'

export interface PineconeVectorStoreOptions {
  apiKey: string
  /** Fully-qualified index host, e.g. https://aio-xxx.svc.region.pinecone.io */
  host?: string
  indexName: string
  namespace?: string
  cloud?: string
  region?: string
}

/**
 * Pinecone serverless / pod index via REST.
 * VECTOR_STORE=pinecone  PINECONE_API_KEY=...  PINECONE_INDEX=aio-vault
 * Optional: PINECONE_HOST=https://....pinecone.io (skips describe-index lookup)
 */
export class PineconeVectorStore implements VectorStore {
  readonly kind = 'pinecone' as const
  private dimension = 0
  private ready = false
  private host = ''

  constructor(private opts: PineconeVectorStoreOptions) {
    this.opts = {
      namespace: '',
      cloud: 'aws',
      region: 'us-east-1',
      ...opts,
    }
    if (opts.host) this.host = opts.host.replace(/\/$/, '')
  }

  private controlHeaders(): Record<string, string> {
    return {
      'Api-Key': this.opts.apiKey,
      'Content-Type': 'application/json',
      'X-Pinecone-Api-Version': '2025-01',
    }
  }

  private dataHeaders(): Record<string, string> {
    return this.controlHeaders()
  }

  async ensureReady(dimension: number): Promise<void> {
    this.dimension = dimension
    if (this.ready && this.host) return

    if (!this.host) {
      try {
        const desc = (await httpJson(
          `https://api.pinecone.io/indexes/${encodeURIComponent(this.opts.indexName)}`,
          { headers: this.controlHeaders(), label: 'Pinecone' }
        )) as { host?: string }
        if (desc.host) this.host = `https://${desc.host.replace(/^https?:\/\//, '')}`
      } catch {
        await httpJson('https://api.pinecone.io/indexes', {
          method: 'POST',
          headers: this.controlHeaders(),
          label: 'Pinecone',
          body: {
            name: this.opts.indexName,
            dimension,
            metric: 'cosine',
            spec: {
              serverless: {
                cloud: this.opts.cloud || 'aws',
                region: this.opts.region || 'us-east-1',
              },
            },
          },
        })
        // Newly created indexes need a moment; poll describe
        for (let i = 0; i < 30; i++) {
          await sleep(2000)
          try {
            const desc = (await httpJson(
              `https://api.pinecone.io/indexes/${encodeURIComponent(this.opts.indexName)}`,
              { headers: this.controlHeaders(), label: 'Pinecone' }
            )) as { host?: string; status?: { ready?: boolean } }
            if (desc.host && desc.status?.ready !== false) {
              this.host = `https://${desc.host.replace(/^https?:\/\//, '')}`
              break
            }
          } catch {
            /* retry */
          }
        }
      }
    }

    if (!this.host) {
      throw new Error(
        `Pinecone index "${this.opts.indexName}" has no host yet. Set PINECONE_HOST or wait for index readiness.`
      )
    }
    this.ready = true
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (!records.length) return
    const vectors = records.map((r) => ({
      id: vectorPointId(r.id),
      values: r.vector,
      metadata: flattenMeta(docToPayload(r.document)),
    }))
    // Pinecone upsert limit ~1000; batch in chunks of 100
    for (let i = 0; i < vectors.length; i += 100) {
      const chunk = vectors.slice(i, i + 100)
      await httpJson(`${this.host}/vectors/upsert`, {
        method: 'POST',
        headers: this.dataHeaders(),
        label: 'Pinecone',
        body: {
          vectors: chunk,
          namespace: this.opts.namespace || undefined,
        },
      })
    }
  }

  async replaceAll(records: VectorRecord[]): Promise<void> {
    await httpJson(`${this.host}/vectors/delete`, {
      method: 'POST',
      headers: this.dataHeaders(),
      label: 'Pinecone',
      body: {
        deleteAll: true,
        namespace: this.opts.namespace || undefined,
      },
    })
    await this.upsert(records)
  }

  async search(vector: number[], topK: number): Promise<VectorSearchHit[]> {
    const data = (await httpJson(`${this.host}/query`, {
      method: 'POST',
      headers: this.dataHeaders(),
      label: 'Pinecone',
      body: {
        vector,
        topK,
        includeMetadata: true,
        namespace: this.opts.namespace || undefined,
      },
    })) as {
      matches?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>
    }
    const hits: VectorSearchHit[] = []
    for (const m of data.matches || []) {
      if (!m.metadata) continue
      const doc = payloadToDoc(unflattenMeta(m.metadata))
      hits.push({ id: asString(m.metadata.path, asString(m.id)), score: m.score, document: doc })
    }
    return hits
  }

  async count(): Promise<number> {
    const data = (await httpJson(`${this.host}/describe_index_stats`, {
      method: 'POST',
      headers: this.dataHeaders(),
      label: 'Pinecone',
      body: {},
    })) as { totalVectorCount?: number; namespaces?: Record<string, { vectorCount?: number }> }
    if (this.opts.namespace && data.namespaces?.[this.opts.namespace]) {
      return data.namespaces[this.opts.namespace].vectorCount ?? 0
    }
    return data.totalVectorCount ?? 0
  }

  async listDocuments(): Promise<KnowledgeDoc[]> {
    // Pinecone has no cheap full scan; use list + fetch in pages when available
    const docs: KnowledgeDoc[] = []
    let paginationToken: string | undefined
    for (let page = 0; page < 50; page++) {
      const list = (await httpJson(
        `${this.host}/vectors/list?${new URLSearchParams({
          ...(this.opts.namespace ? { namespace: this.opts.namespace } : {}),
          ...(paginationToken ? { paginationToken } : {}),
          limit: '100',
        }).toString()}`,
        { headers: this.dataHeaders(), label: 'Pinecone' }
      )) as { vectors?: Array<{ id: string }>; pagination?: { next?: string } }

      const ids = (list.vectors || []).map((v) => v.id)
      if (!ids.length) break
      const got = (await httpJson(
        `${this.host}/vectors/fetch?${ids.map((id) => `ids=${encodeURIComponent(id)}`).join('&')}${
          this.opts.namespace ? `&namespace=${encodeURIComponent(this.opts.namespace)}` : ''
        }`,
        { headers: this.dataHeaders(), label: 'Pinecone' }
      )) as { vectors?: Record<string, { metadata?: Record<string, unknown> }> }

      for (const v of Object.values(got.vectors || {})) {
        if (v.metadata) docs.push(payloadToDoc(unflattenMeta(v.metadata)))
      }
      paginationToken = list.pagination?.next
      if (!paginationToken) break
    }
    return docs
  }

  async persist(): Promise<void> {}
}

/** Pinecone metadata values must be string | number | boolean | string[] */
function flattenMeta(
  payload: Record<string, unknown>
): Record<string, string | number | boolean | string[]> {
  return {
    path: asString(payload.path),
    title: asString(payload.title),
    content: asString(payload.content).slice(0, 35000),
    tags: asStringArray(payload.tags),
    links: asStringArray(payload.links),
    createdAt: asString(payload.createdAt),
  }
}

function unflattenMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return { ...meta }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
