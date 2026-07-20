export { ObsidianVault } from './vault'
export { createEmbedder } from './embedder'
export type { Embedder } from './embedder'
export { SemanticSearch, createSemanticSearch, resolveVectorStoreKind } from './search'
export { createVectorStore, VECTOR_STORE_KINDS } from './vector-store'
export type { VectorStore, VectorStoreKind } from './vector-store'
export { resolveProjectRoot, resolveVaultRoot, resolveIndexDir, toPosixPath } from './paths'
export { resolveIndexFlatIP, loadFaissIndexFlatIP } from './faiss'
export { DEFAULT_WIKI_SCHEMA, WIKI_SCHEMA_PATH, slugifyTitle } from './wiki-schema'
export {
  getWikiSchema,
  ingestRaw,
  ingestSource,
  updateWikiPage,
  queryWiki,
  fileBack,
  lintWiki,
} from './wiki-ops'
export type { LintResult, IngestSourceInput, FileBackInput } from './wiki-ops'

export type { KnowledgeDoc, SearchResult, Issue } from './types'
