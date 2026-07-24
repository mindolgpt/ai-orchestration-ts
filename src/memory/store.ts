import * as fs from 'fs/promises'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  MemoryEntry,
  MemoryKind,
  AnchorType,
  Confidence,
  MemoryStoreEntry,
  MemorySearchResult,
} from './types'

export class MemoryStore {
  private entries: Map<string, MemoryStoreEntry> = new Map()
  private storePath: string
  /** Serializes read-modify-persist transactions to prevent lost writes. */
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(baseDir: string) {
    this.storePath = path.join(baseDir, '.aio', 'memory.json')
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.storePath, 'utf-8')
      const arr = JSON.parse(data) as MemoryStoreEntry[]
      this.entries.clear()
      for (const entry of arr) this.entries.set(entry.id, entry)
    } catch {
      this.entries.clear()
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true })
    await fs.writeFile(
      this.storePath,
      JSON.stringify(Array.from(this.entries.values()), null, 2),
      'utf-8'
    )
  }

  /**
   * Run a mutating transaction (load → mutate → persist) strictly serially
   * inside this process. This is what closes the lost-write window that two
   * concurrent `set()`/`update()`/`delete()` calls previously had.
   *
   * Each transaction awaits the previous one before its own load, so by the
   * time it calls `persist()` it necessarily saw every prior mutation.
   */
  private transaction<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn)
    // Swallow rejection on the chain itself so the next writer isn't blocked,
    // but keep the per-call promise so the caller sees its own rejection.
    this.writeChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async set(
    kind: MemoryKind,
    anchorType: AnchorType,
    anchorId: string,
    content: string,
    author = 'user',
    confidence: Confidence = 'proposed'
  ): Promise<MemoryEntry> {
    return this.transaction(async () => {
      await this.load()

      const existing = Array.from(this.entries.values())
        .filter((e) => e.anchorType === anchorType && e.anchorId === anchorId && !e.supersededBy)
        .sort((a, b) => b.version - a.version)

      const latestVersion = existing.length > 0 ? existing[0].version : 0

      const entry: MemoryStoreEntry = {
        id: `mem_${randomUUID().slice(0, 8)}`,
        kind,
        anchorType,
        anchorId,
        content,
        author,
        confidence,
        recordedAt: Date.now(),
        version: latestVersion + 1,
        supersededBy: null,
      }

      this.entries.set(entry.id, entry)
      await this.persist()

      return this.toEntry(entry)
    })
  }

  async update(
    id: string,
    content: string,
    author = 'user',
    confidence?: Confidence
  ): Promise<MemoryEntry | undefined> {
    return this.transaction(async () => {
      await this.load()

      const existing = this.entries.get(id)
      if (!existing) return undefined

      existing.supersededBy = `mem_${randomUUID().slice(0, 8)}`

      const newEntry: MemoryStoreEntry = {
        id: existing.supersededBy,
        kind: existing.kind,
        anchorType: existing.anchorType,
        anchorId: existing.anchorId,
        content,
        author,
        confidence: confidence || existing.confidence,
        recordedAt: Date.now(),
        version: existing.version + 1,
        supersededBy: null,
      }

      this.entries.set(newEntry.id, newEntry)
      await this.persist()

      return this.toEntry(newEntry)
    })
  }

  async getByAnchor(
    anchorType: AnchorType,
    anchorId: string,
    includeSuperseded = false
  ): Promise<MemoryEntry[]> {
    await this.load()

    return Array.from(this.entries.values())
      .filter((e) => e.anchorType === anchorType && e.anchorId === anchorId)
      .filter((e) => includeSuperseded || !e.supersededBy)
      .sort((a, b) => b.version - a.version)
      .map((e) => this.toEntry(e))
  }

  async search(query: string, kinds?: MemoryKind[]): Promise<MemorySearchResult[]> {
    await this.load()

    const lower = query.toLowerCase()
    const results: MemorySearchResult[] = []

    for (const entry of this.entries.values()) {
      if (entry.supersededBy) continue
      if (kinds && !kinds.includes(entry.kind)) continue

      const text = `${entry.content} ${entry.anchorId}`.toLowerCase()
      if (!text.includes(lower)) continue

      const score = computeRelevance(entry.content, query)
      results.push({
        id: entry.id,
        kind: entry.kind,
        anchorType: entry.anchorType,
        anchorId: entry.anchorId,
        snippet: entry.content.slice(0, 200),
        score,
      })
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 20)
  }

  async delete(id: string, soft = true): Promise<boolean> {
    return this.transaction(async () => {
      await this.load()

      const entry = this.entries.get(id)
      if (!entry) return false

      if (soft) {
        entry.supersededBy = '__deleted__'
      } else {
        this.entries.delete(id)
      }

      await this.persist()
      return true
    })
  }

  async count(): Promise<number> {
    await this.load()
    return Array.from(this.entries.values()).filter((e) => !e.supersededBy).length
  }

  private toEntry(store: MemoryStoreEntry): MemoryEntry {
    return {
      id: store.id,
      kind: store.kind,
      anchorType: store.anchorType,
      anchorId: store.anchorId,
      content: store.content,
      provenance: {
        author: store.author,
        confidence: store.confidence,
        recordedAt: store.recordedAt,
      },
      version: store.version,
      supersededBy: store.supersededBy || undefined,
    }
  }
}

function computeRelevance(content: string, query: string): number {
  const lower = content.toLowerCase()
  const q = query.toLowerCase()
  let score = 0

  if (lower.includes(q)) score += 10
  if (lower.startsWith(q)) score += 5

  const qWords = q.split(/\s+/).filter(Boolean)
  const contentWords = new Set(lower.split(/\s+/))
  const matches = qWords.filter((w) => contentWords.has(w)).length
  if (qWords.length > 0) {
    score += (matches / qWords.length) * 20
  }

  return score
}
