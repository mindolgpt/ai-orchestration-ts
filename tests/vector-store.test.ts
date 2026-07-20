/// <reference types="vitest/globals" />
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { SemanticSearch } from '../src/knowledge/search'
import {
  collectionNameForVault,
  createVectorStore,
  resolveVectorStoreKind,
  vectorPointId,
} from '../src/knowledge/vector-store'
import { QdrantVectorStore } from '../src/knowledge/vector-store-qdrant'

describe('vector store env switch', () => {
  const keys = [
    'VECTOR_STORE',
    'AIO_VECTOR_STORE',
    'VECTOR_COLLECTION',
    'PINECONE_API_KEY',
    'PINECONE_INDEX',
    'DATABASE_URL',
    'QDRANT_COLLECTION',
    'CHROMA_COLLECTION',
    'WEAVIATE_CLASS',
    'PGVECTOR_TABLE',
  ] as const
  const prev: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of keys) prev[k] = process.env[k]
  })

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  })

  test('defaults to faiss', () => {
    delete process.env.VECTOR_STORE
    delete process.env.AIO_VECTOR_STORE
    expect(resolveVectorStoreKind()).toBe('faiss')
    const store = createVectorStore({ indexDir: '/tmp/aio-index' })
    expect(store.kind).toBe('faiss')
  })

  test('VECTOR_STORE selects remote backends', () => {
    process.env.VECTOR_STORE = 'qdrant'
    expect(resolveVectorStoreKind()).toBe('qdrant')
    expect(createVectorStore({ indexDir: '/tmp/vault/.index', vaultRoot: '/tmp/vault' }).kind).toBe(
      'qdrant'
    )
    expect(
      createVectorStore({ indexDir: '/tmp/vault/.index', vaultRoot: '/tmp/vault' })
    ).toBeInstanceOf(QdrantVectorStore)

    process.env.VECTOR_STORE = 'chroma'
    expect(createVectorStore({ indexDir: '/tmp/v/.index', vaultRoot: '/tmp/v' }).kind).toBe(
      'chroma'
    )

    process.env.VECTOR_STORE = 'weaviate'
    expect(createVectorStore({ indexDir: '/tmp/v/.index', vaultRoot: '/tmp/v' }).kind).toBe(
      'weaviate'
    )

    process.env.VECTOR_STORE = 'pinecone'
    process.env.PINECONE_API_KEY = 'test-key'
    process.env.PINECONE_INDEX = 'aio-test'
    expect(createVectorStore({ indexDir: '/tmp/v/.index', vaultRoot: '/tmp/v' }).kind).toBe(
      'pinecone'
    )

    process.env.VECTOR_STORE = 'pgvector'
    process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db'
    expect(createVectorStore({ indexDir: '/tmp/v/.index', vaultRoot: '/tmp/v' }).kind).toBe(
      'pgvector'
    )
  })

  test('collection naming', () => {
    expect(collectionNameForVault('/proj/my-Vault', 'shop')).toBe('aio_shop')
    expect(vectorPointId('wiki/cart')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })
})

describe('SemanticSearch faiss path (default)', () => {
  test('add + search + save roundtrip', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-vs-'))
    const indexDir = path.join(root, '.index')
    const embedder = {
      dimension: 3,
      async embed(texts: string[]) {
        return texts.map((t) => {
          const n = t.length || 1
          const v = [n, n * 0.5, 1]
          const norm = Math.hypot(...v) || 1
          return v.map((x) => x / norm)
        })
      },
    }
    const search = new SemanticSearch(embedder, indexDir)
    await search.load()
    await search.addDocument('wiki/a', 'A', 'cart checkout rules')
    await search.save()
    expect(search.documentCount).toBe(1)
    expect(search.storeKind).toBe('faiss')
    const hits = await search.search('cart', 3)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].title).toBe('A')
    // meta.json is always persisted (vectors may be mock/in-memory without faiss-node)
    await expect(fs.stat(path.join(indexDir, 'meta.json'))).resolves.toBeDefined()
  })
})
