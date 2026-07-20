import { KnowledgeDoc } from '@/knowledge/types'
import { VectorRecord, VectorSearchHit, VectorStore, vectorPointId } from '@/knowledge/vector-store'
import { asString, asStringArray } from '@/knowledge/vector-store-shared'

export interface PgvectorStoreOptions {
  connectionString: string
  table: string
}

type PgPool = {
  query: (
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>
  end: () => Promise<void>
}

/**
 * PostgreSQL + pgvector.
 * VECTOR_STORE=pgvector  DATABASE_URL=postgres://...
 * Optional: PGVECTOR_TABLE=aio_vectors
 *
 * Requires the `pg` package and `CREATE EXTENSION vector` on the database.
 */
export class PgvectorStore implements VectorStore {
  readonly kind = 'pgvector' as const
  private dimension = 0
  private ready = false
  private pool: PgPool | null = null

  constructor(private opts: PgvectorStoreOptions) {
    this.opts = {
      ...opts,
      table: sanitizeTable(opts.table || 'aio_vectors'),
    }
  }

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool
    let mod: unknown
    try {
      mod = await import('pg')
    } catch {
      throw new Error(
        'VECTOR_STORE=pgvector requires the `pg` package. Install with: npm i pg && npm i -D @types/pg'
      )
    }
    const rec = mod as {
      Pool?: new (opts: { connectionString: string }) => PgPool
      default?: { Pool?: new (opts: { connectionString: string }) => PgPool }
    }
    const Pool = rec.Pool || rec.default?.Pool
    if (!Pool) throw new Error('pg.Pool not found')
    this.pool = new Pool({ connectionString: this.opts.connectionString })
    return this.pool
  }

  async ensureReady(dimension: number): Promise<void> {
    this.dimension = dimension
    if (this.ready) return
    const pool = await this.getPool()
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.opts.table} (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        links JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        embedding vector(${dimension}) NOT NULL
      )
    `)
    // Best-effort index (may fail on empty table for ivfflat — ignore)
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS ${this.opts.table}_embedding_idx
        ON ${this.opts.table}
        USING hnsw (embedding vector_cosine_ops)
      `)
    } catch {
      try {
        await pool.query(`
          CREATE INDEX IF NOT EXISTS ${this.opts.table}_embedding_idx
          ON ${this.opts.table}
          USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = 100)
        `)
      } catch {
        /* sequential scan ok for small corpora */
      }
    }
    this.ready = true
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (!records.length) return
    const pool = await this.getPool()
    for (const r of records) {
      const id = vectorPointId(r.id)
      const d = r.document
      const vec = `[${r.vector.join(',')}]`
      await pool.query(
        `
        INSERT INTO ${this.opts.table}
          (id, path, title, content, tags, links, created_at, embedding)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::timestamptz, $8::vector)
        ON CONFLICT (id) DO UPDATE SET
          path = EXCLUDED.path,
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          tags = EXCLUDED.tags,
          links = EXCLUDED.links,
          created_at = EXCLUDED.created_at,
          embedding = EXCLUDED.embedding
        `,
        [
          id,
          d.path,
          d.title,
          d.content,
          JSON.stringify(d.tags || []),
          JSON.stringify(d.links || []),
          d.createdAt,
          vec,
        ]
      )
    }
  }

  async replaceAll(records: VectorRecord[]): Promise<void> {
    const pool = await this.getPool()
    await pool.query(`TRUNCATE TABLE ${this.opts.table}`)
    await this.upsert(records)
  }

  async search(vector: number[], topK: number): Promise<VectorSearchHit[]> {
    const pool = await this.getPool()
    const vec = `[${vector.join(',')}]`
    const res = await pool.query(
      `
      SELECT path, title, content, tags, links, created_at,
             1 - (embedding <=> $1::vector) AS score
      FROM ${this.opts.table}
      ORDER BY embedding <=> $1::vector
      LIMIT $2
      `,
      [vec, topK]
    )
    return res.rows.map((row) => ({
      id: asString(row.path),
      score: Number(row.score) || 0,
      document: rowToDoc(row),
    }))
  }

  async count(): Promise<number> {
    const pool = await this.getPool()
    const res = await pool.query(`SELECT COUNT(*)::int AS n FROM ${this.opts.table}`)
    return Number(res.rows[0]?.n) || 0
  }

  async listDocuments(): Promise<KnowledgeDoc[]> {
    const pool = await this.getPool()
    const res = await pool.query(
      `SELECT path, title, content, tags, links, created_at FROM ${this.opts.table}`
    )
    return res.rows.map(rowToDoc)
  }

  async persist(): Promise<void> {}
}

function rowToDoc(row: Record<string, unknown>): KnowledgeDoc {
  return {
    path: asString(row.path),
    title: asString(row.title),
    content: asString(row.content),
    tags: asStringArray(row.tags),
    links: asStringArray(row.links),
    createdAt: asString(row.created_at ?? row.createdAt, new Date().toISOString()),
  }
}

function sanitizeTable(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  return cleaned || 'aio_vectors'
}
