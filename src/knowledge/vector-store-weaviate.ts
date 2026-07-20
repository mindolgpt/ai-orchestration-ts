import { KnowledgeDoc } from '@/knowledge/types'
import { VectorRecord, VectorSearchHit, VectorStore, vectorPointId } from '@/knowledge/vector-store'
import { asString, docToPayload, httpJson, payloadToDoc } from '@/knowledge/vector-store-shared'

export interface WeaviateVectorStoreOptions {
  url: string
  apiKey?: string
  className: string
}

/**
 * Weaviate REST + GraphQL.
 * VECTOR_STORE=weaviate  WEAVIATE_URL=http://127.0.0.1:8080
 */
export class WeaviateVectorStore implements VectorStore {
  readonly kind = 'weaviate' as const
  private dimension = 0
  private ready = false

  constructor(private opts: WeaviateVectorStoreOptions) {
    this.opts = {
      ...opts,
      url: opts.url.replace(/\/$/, ''),
      className: sanitizeClassName(opts.className),
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.opts.apiKey) h.Authorization = `Bearer ${this.opts.apiKey}`
    return h
  }

  async ensureReady(dimension: number): Promise<void> {
    this.dimension = dimension
    if (this.ready) return

    const schema = (await httpJson(`${this.opts.url}/v1/schema`, {
      headers: this.headers(),
      label: 'Weaviate',
    }).catch(() => ({ classes: [] }))) as { classes?: Array<{ class?: string }> }

    const exists = (schema.classes || []).some((c) => c.class === this.opts.className)
    if (!exists) {
      await httpJson(`${this.opts.url}/v1/schema`, {
        method: 'POST',
        headers: this.headers(),
        label: 'Weaviate',
        body: {
          class: this.opts.className,
          vectorizer: 'none',
          properties: [
            { name: 'path', dataType: ['text'] },
            { name: 'title', dataType: ['text'] },
            { name: 'content', dataType: ['text'] },
            { name: 'tags', dataType: ['text[]'] },
            { name: 'links', dataType: ['text[]'] },
            { name: 'createdAt', dataType: ['text'] },
          ],
        },
      })
    }
    this.ready = true
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (!records.length) return
    const objects = records.map((r) => {
      const p = docToPayload(r.document)
      return {
        id: vectorPointId(r.id),
        class: this.opts.className,
        properties: {
          path: p.path,
          title: p.title,
          content: p.content,
          tags: p.tags,
          links: p.links,
          createdAt: p.createdAt,
        },
        vector: r.vector,
      }
    })
    for (let i = 0; i < objects.length; i += 50) {
      await httpJson(`${this.opts.url}/v1/batch/objects`, {
        method: 'POST',
        headers: this.headers(),
        label: 'Weaviate',
        body: { objects: objects.slice(i, i + 50) },
      })
    }
  }

  async replaceAll(records: VectorRecord[]): Promise<void> {
    try {
      await httpJson(`${this.opts.url}/v1/schema/${encodeURIComponent(this.opts.className)}`, {
        method: 'DELETE',
        headers: this.headers(),
        label: 'Weaviate',
      })
    } catch {
      /* ok */
    }
    this.ready = false
    await this.ensureReady(this.dimension)
    await this.upsert(records)
  }

  async search(vector: number[], topK: number): Promise<VectorSearchHit[]> {
    const vecLit = JSON.stringify(vector)
    const query = `{
      Get {
        ${this.opts.className}(nearVector: {vector: ${vecLit}}, limit: ${topK}) {
          path
          title
          content
          tags
          links
          createdAt
          _additional { id distance certainty }
        }
      }
    }`
    const data = (await httpJson(`${this.opts.url}/v1/graphql`, {
      method: 'POST',
      headers: this.headers(),
      label: 'Weaviate',
      body: { query },
    })) as {
      data?: { Get?: Record<string, Array<Record<string, unknown>>> }
      errors?: unknown
    }
    if (data.errors) {
      throw new Error(`Weaviate GraphQL error: ${JSON.stringify(data.errors).slice(0, 300)}`)
    }
    const rows = data.data?.Get?.[this.opts.className] || []
    return rows.map((row) => {
      const additional = (row._additional || {}) as {
        distance?: number
        certainty?: number
        id?: string
      }
      const doc = payloadToDoc(row)
      const score =
        typeof additional.certainty === 'number'
          ? additional.certainty
          : typeof additional.distance === 'number'
            ? 1 - additional.distance
            : 0
      return { id: asString(row.path, asString(additional.id)), score, document: doc }
    })
  }

  async count(): Promise<number> {
    const query = `{ Aggregate { ${this.opts.className} { meta { count } } } }`
    const data = (await httpJson(`${this.opts.url}/v1/graphql`, {
      method: 'POST',
      headers: this.headers(),
      label: 'Weaviate',
      body: { query },
    })) as {
      data?: { Aggregate?: Record<string, Array<{ meta?: { count?: number } }>> }
    }
    return data.data?.Aggregate?.[this.opts.className]?.[0]?.meta?.count ?? 0
  }

  async listDocuments(): Promise<KnowledgeDoc[]> {
    const docs: KnowledgeDoc[] = []
    let after: string | null = null
    for (let page = 0; page < 50; page++) {
      const afterClause = after ? `, after: "${after}"` : ''
      const query = `{
        Get {
          ${this.opts.className}(limit: 100${afterClause}) {
            path title content tags links createdAt
            _additional { id }
          }
        }
      }`
      const data = (await httpJson(`${this.opts.url}/v1/graphql`, {
        method: 'POST',
        headers: this.headers(),
        label: 'Weaviate',
        body: { query },
      })) as {
        data?: { Get?: Record<string, Array<Record<string, unknown>>> }
      }
      const rows = data.data?.Get?.[this.opts.className] || []
      if (!rows.length) break
      for (const row of rows) {
        docs.push(payloadToDoc(row))
        const id = (row._additional as { id?: string } | undefined)?.id
        if (id) after = id
      }
      if (rows.length < 100) break
    }
    return docs
  }

  async persist(): Promise<void> {}
}

function sanitizeClassName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_')
  const withPrefix = /^[A-Z]/.test(cleaned) ? cleaned : `Aio_${cleaned}`
  return withPrefix.slice(0, 60)
}
