import * as path from 'path'
import { createHash } from 'crypto'
import { KnowledgeDoc } from '@/knowledge/types'
import { FaissVectorStore } from '@/knowledge/vector-store-faiss'
import { QdrantVectorStore } from '@/knowledge/vector-store-qdrant'
import { ChromaVectorStore } from '@/knowledge/vector-store-chroma'
import { PineconeVectorStore } from '@/knowledge/vector-store-pinecone'
import { WeaviateVectorStore } from '@/knowledge/vector-store-weaviate'
import { PgvectorStore } from '@/knowledge/vector-store-pgvector'

export type VectorStoreKind = 'faiss' | 'qdrant' | 'chroma' | 'pinecone' | 'weaviate' | 'pgvector'

export const VECTOR_STORE_KINDS: VectorStoreKind[] = [
  'faiss',
  'qdrant',
  'chroma',
  'pinecone',
  'weaviate',
  'pgvector',
]

export interface VectorRecord {
  id: string
  vector: number[]
  document: KnowledgeDoc
}

export interface VectorSearchHit {
  id: string
  score: number
  document: KnowledgeDoc
}

export interface VectorStore {
  readonly kind: VectorStoreKind
  ensureReady(dimension: number): Promise<void>
  upsert(records: VectorRecord[]): Promise<void>
  /** Full rebuild (FAISS upsert-by-rebuild for updates). */
  replaceAll(records: VectorRecord[]): Promise<void>
  search(vector: number[], topK: number): Promise<VectorSearchHit[]>
  count(): Promise<number>
  listDocuments(): Promise<KnowledgeDoc[]>
  persist(): Promise<void>
}

export interface CreateVectorStoreOptions {
  indexDir: string
  vaultRoot?: string
  collectionHint?: string
}

export function resolveVectorStoreKind(): VectorStoreKind {
  const raw = (process.env.VECTOR_STORE || process.env.AIO_VECTOR_STORE || 'faiss')
    .trim()
    .toLowerCase()
  if ((VECTOR_STORE_KINDS as string[]).includes(raw)) return raw as VectorStoreKind
  return 'faiss'
}

/** Deterministic UUID-like id from doc path (stable across restarts). */
export function vectorPointId(docPath: string): string {
  const h = createHash('sha256').update(docPath).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/**
 * Collection / index / class / table name for a vault.
 * Override with VECTOR_COLLECTION, or store-specific *COLLECTION / PINECONE_INDEX / PGVECTOR_TABLE.
 */
export function collectionNameForVault(vaultRoot: string, hint?: string): string {
  const override =
    process.env.VECTOR_COLLECTION?.trim() ||
    process.env.QDRANT_COLLECTION?.trim() ||
    process.env.CHROMA_COLLECTION?.trim() ||
    process.env.WEAVIATE_CLASS?.trim() ||
    process.env.PINECONE_INDEX?.trim() ||
    process.env.PGVECTOR_TABLE?.trim()
  if (override) return override

  const prefix =
    (process.env.VECTOR_COLLECTION_PREFIX || process.env.QDRANT_COLLECTION_PREFIX || 'aio')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_') || 'aio'
  const base = (hint || path.basename(path.resolve(vaultRoot)) || 'vault')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return `${prefix}_${base || 'vault'}`
}

export function createVectorStore(opts: CreateVectorStoreOptions): VectorStore {
  const kind = resolveVectorStoreKind()
  const vaultRoot = opts.vaultRoot || path.dirname(opts.indexDir)
  const collection = collectionNameForVault(
    vaultRoot,
    opts.collectionHint || process.env.AIO_VAULT_NAME
  )

  switch (kind) {
    case 'qdrant':
      return new QdrantVectorStore({
        url: process.env.QDRANT_URL || 'http://127.0.0.1:6333',
        apiKey: process.env.QDRANT_API_KEY?.trim() || undefined,
        collection,
      })
    case 'chroma':
      return new ChromaVectorStore({
        url: process.env.CHROMA_URL || 'http://127.0.0.1:8000',
        collection,
        apiKey: process.env.CHROMA_API_KEY?.trim() || undefined,
        tenant: process.env.CHROMA_TENANT?.trim() || undefined,
        database: process.env.CHROMA_DATABASE?.trim() || undefined,
      })
    case 'pinecone': {
      const apiKey = process.env.PINECONE_API_KEY?.trim()
      if (!apiKey) {
        throw new Error('VECTOR_STORE=pinecone requires PINECONE_API_KEY')
      }
      return new PineconeVectorStore({
        apiKey,
        indexName: process.env.PINECONE_INDEX?.trim() || collection,
        host: process.env.PINECONE_HOST?.trim() || undefined,
        namespace: process.env.PINECONE_NAMESPACE?.trim() || undefined,
        cloud: process.env.PINECONE_CLOUD?.trim() || undefined,
        region: process.env.PINECONE_REGION?.trim() || undefined,
      })
    }
    case 'weaviate':
      return new WeaviateVectorStore({
        url: process.env.WEAVIATE_URL || 'http://127.0.0.1:8080',
        apiKey: process.env.WEAVIATE_API_KEY?.trim() || undefined,
        className: process.env.WEAVIATE_CLASS?.trim() || collection,
      })
    case 'pgvector': {
      const connectionString =
        process.env.DATABASE_URL?.trim() ||
        process.env.PGVECTOR_URL?.trim() ||
        process.env.POSTGRES_URL?.trim()
      if (!connectionString) {
        throw new Error(
          'VECTOR_STORE=pgvector requires DATABASE_URL (or PGVECTOR_URL / POSTGRES_URL)'
        )
      }
      return new PgvectorStore({
        connectionString,
        table: process.env.PGVECTOR_TABLE?.trim() || collection,
      })
    }
    case 'faiss':
    default:
      return new FaissVectorStore(opts.indexDir)
  }
}
