import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as path from 'path'
import { ObsidianVault } from '@/knowledge/vault'
import { SemanticSearch } from '@/knowledge/search'
import { ingestPipeline } from '@/knowledge/wiki-ingest-pipeline'
import { getEventLog } from '@/observability/events'

const INBOX_DIR = 'raw-inbox'
const PROCESSED_DIR = 'raw-inbox/processed'
const FAILED_DIR = 'raw-inbox/failed'

export interface RawInboxProcessResult {
  file: string
  ok: boolean
  raw_id?: string
  wiki_pages?: string[]
  error?: string
}

export function rawInboxDir(vaultRoot: string): string {
  return path.join(vaultRoot, INBOX_DIR)
}

export async function ensureRawInbox(vaultRoot: string): Promise<void> {
  await fsPromises.mkdir(path.join(vaultRoot, PROCESSED_DIR), { recursive: true })
  await fsPromises.mkdir(path.join(vaultRoot, FAILED_DIR), { recursive: true })
  await fsPromises.mkdir(rawInboxDir(vaultRoot), { recursive: true })
}

const TEXT_EXT = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.xml', '.html', '.htm'])

function isTextFile(name: string): boolean {
  return TEXT_EXT.has(path.extname(name).toLowerCase())
}

export async function scanRawInbox(
  vault: ObsidianVault,
  search: SemanticSearch,
  opts?: {
    project_root?: string
    subdir?: string
    run_lint?: boolean
  }
): Promise<{ processed: RawInboxProcessResult[]; pending: string[] }> {
  const vaultRoot = vault.rootPath
  await ensureRawInbox(vaultRoot)
  const inbox = rawInboxDir(vaultRoot)

  let names: string[]
  try {
    names = await fsPromises.readdir(inbox)
  } catch {
    names = []
  }

  const pending = names.filter(
    (n) => !n.startsWith('.') && isTextFile(n) && n !== 'processed' && n !== 'failed'
  )

  const processed: RawInboxProcessResult[] = []
  const projectRoot = opts?.project_root

  for (const name of pending) {
    const abs = path.join(inbox, name)
    try {
      const stat = await fsPromises.stat(abs)
      if (!stat.isFile()) continue

      const title = path.basename(name, path.extname(name)).replace(/[-_]+/g, ' ')
      const result = await ingestPipeline(vault, search, {
        title,
        file_path: abs,
        project_root: projectRoot,
        concepts: [{ title, subdir: opts?.subdir || 'domain' }],
        run_lint: opts?.run_lint !== false,
      })

      const dest = path.join(vaultRoot, PROCESSED_DIR, `${Date.now()}-${name}`)
      await fsPromises.rename(abs, dest)

      processed.push({
        file: name,
        ok: true,
        raw_id: result.raw.id,
        wiki_pages: result.wiki_pages.map((p) => p.wiki_page),
      })

      if (projectRoot) {
        await getEventLog(projectRoot).emit('raw.inbox.processed', {
          file: name,
          raw_id: result.raw.id,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try {
        await fsPromises.rename(abs, path.join(vaultRoot, FAILED_DIR, `${Date.now()}-${name}`))
      } catch {
        /* leave in place */
      }
      processed.push({ file: name, ok: false, error: msg })
    }
  }

  return { processed, pending: pending.filter((n) => !processed.some((p) => p.file === n)) }
}

export interface RawInboxWatcherOptions {
  vault: ObsidianVault
  search: SemanticSearch
  project_root?: string
  subdir?: string
  poll_ms?: number
  onProcessed?: (results: RawInboxProcessResult[]) => void
}

export async function watchRawInbox(opts: RawInboxWatcherOptions): Promise<{ stop: () => void }> {
  const vaultRoot = opts.vault.rootPath
  await ensureRawInbox(vaultRoot)
  const inbox = rawInboxDir(vaultRoot)
  let running = true
  let debounce: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<void> | null = null

  const tick = async () => {
    if (!running) return
    if (inflight) return
    inflight = (async () => {
      const { processed } = await scanRawInbox(opts.vault, opts.search, {
        project_root: opts.project_root,
        subdir: opts.subdir,
      })
      if (processed.length && opts.onProcessed) opts.onProcessed(processed)
    })().finally(() => {
      inflight = null
    })
    await inflight
  }

  const schedule = () => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      void tick().catch(console.error)
    }, 800)
  }

  try {
    const watcher = fs.watch(inbox, { persistent: true }, schedule)
    const poll = setInterval(() => {
      void tick().catch(console.error)
    }, opts.poll_ms ?? 5000)

    await tick()

    return {
      stop: () => {
        running = false
        watcher.close()
        clearInterval(poll)
        if (debounce) clearTimeout(debounce)
      },
    }
  } catch {
    const poll = setInterval(() => {
      void tick().catch(console.error)
    }, opts.poll_ms ?? 3000)
    await tick()
    return {
      stop: () => {
        running = false
        clearInterval(poll)
        if (debounce) clearTimeout(debounce)
      },
    }
  }
}
