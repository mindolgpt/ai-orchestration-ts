import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import { resolveProjectRoot } from '@/knowledge/paths'

export interface InboxMessage {
  id: string
  sessionId: string
  sender: string
  status: string
  payload: Record<string, unknown>
  timestamp: number
  read: boolean
}

export type InboxBackend = 'memory' | 'file' | 'redis'

export interface InboxOptions {
  storagePath?: string
  backend?: InboxBackend
  redisUrl?: string
}

type RedisLike = {
  rpush: (key: string, ...args: string[]) => Promise<number>
  lrange: (key: string, start: number, stop: number) => Promise<string[]>
  del: (key: string) => Promise<number>
  quit: () => Promise<string>
}

let msgSeq = 0

function nextId(): string {
  msgSeq += 1
  return `msg_${Date.now()}_${msgSeq}`
}

/**
 * Message inbox with optional JSONL/file persistence or Redis list.
 * Env: AIO_INBOX_BACKEND=memory|file|redis (default file)
 *      AIO_INBOX_REDIS_URL / REDIS_URL
 */
export class MessageInbox {
  private messages: InboxMessage[] = []
  private storagePath: string
  private stateFile: string
  private jsonlFile: string
  private backend: InboxBackend
  private redis: RedisLike | null = null
  private redisKey = 'aio:inbox'
  private ready: Promise<void>
  private persistChain: Promise<void> = Promise.resolve()

  constructor(storagePathOrOpts?: string | InboxOptions) {
    const opts: InboxOptions =
      typeof storagePathOrOpts === 'string'
        ? { storagePath: storagePathOrOpts }
        : storagePathOrOpts || {}

    const root = resolveProjectRoot()
    this.storagePath = opts.storagePath || path.join(root, '.aio', 'inbox')
    this.stateFile = path.join(this.storagePath, 'state.json')
    this.jsonlFile = path.join(this.storagePath, 'messages.jsonl')

    const envBackend = (process.env.AIO_INBOX_BACKEND || '').toLowerCase()
    this.backend =
      opts.backend ||
      (envBackend === 'redis' || envBackend === 'memory' || envBackend === 'file'
        ? envBackend
        : 'file')

    this.ready = this.init(
      opts.redisUrl || process.env.AIO_INBOX_REDIS_URL || process.env.REDIS_URL
    )
  }

  private async init(redisUrl?: string): Promise<void> {
    if (this.backend === 'redis' && redisUrl) {
      try {
        const mod = await import('ioredis')
        const Redis = (mod as { default: new (url: string) => RedisLike }).default
        this.redis = new Redis(redisUrl)
        const rows = await this.redis.lrange(this.redisKey, 0, -1)
        this.messages = rows
          .map((r) => {
            try {
              return JSON.parse(r) as InboxMessage
            } catch {
              return null
            }
          })
          .filter((m): m is InboxMessage => !!m)
        return
      } catch {
        this.backend = 'file'
        this.redis = null
      }
    }

    if (this.backend === 'memory') return

    try {
      await fsp.mkdir(this.storagePath, { recursive: true })
      if (fs.existsSync(this.stateFile)) {
        const raw = await fsp.readFile(this.stateFile, 'utf-8')
        this.messages = JSON.parse(raw) as InboxMessage[]
      }
    } catch {
      this.messages = []
    }
  }

  async ensureReady(): Promise<void> {
    await this.ready
  }

  post(
    sessionId: string,
    sender: string,
    status: string,
    payload: Record<string, unknown> = {}
  ): InboxMessage {
    const message: InboxMessage = {
      id: nextId(),
      sessionId,
      sender,
      status,
      payload,
      timestamp: Date.now(),
      read: false,
    }
    this.messages.push(message)
    this.schedulePersist()
    return message
  }

  /** Wait for all pending file/redis writes (use after post() before opening a new inbox). */
  async flush(): Promise<void> {
    await this.ready
    await this.persistChain
  }

  private schedulePersist(): void {
    this.persistChain = this.persistChain
      .then(() => this.persist())
      .catch((err) => {
        console.error('[aio] inbox persist failed:', err)
      })
  }

  poll(sessionId?: string, status?: string, unreadOnly = true): InboxMessage[] {
    const matched = this.messages.filter((m) => {
      if (unreadOnly && m.read) return false
      if (sessionId && m.sessionId !== sessionId) return false
      if (status && m.status !== status) return false
      return true
    })
    for (const m of matched) m.read = true
    if (matched.length) this.schedulePersist()
    return matched
  }

  getSessionResults(sessionId: string): InboxMessage[] {
    return this.messages.filter((m) => m.sessionId === sessionId)
  }

  peek(sessionId?: string, unreadOnly = false): InboxMessage[] {
    return this.messages.filter((m) => {
      if (unreadOnly && m.read) return false
      if (sessionId && m.sessionId !== sessionId) return false
      return true
    })
  }

  summary(): string {
    const byStatus: Record<string, number> = {}
    for (const m of this.messages) {
      byStatus[m.status] = (byStatus[m.status] || 0) + 1
    }
    const parts = [`Inbox: ${this.messages.length} messages (${this.backend})`]
    for (const [s, c] of Object.entries(byStatus).sort()) {
      parts.push(`  ${s}: ${c}`)
    }
    return parts.join('\n')
  }

  clear(): void {
    this.messages = []
    this.schedulePersist()
  }

  get backendName(): InboxBackend {
    return this.backend
  }

  private async persist(): Promise<void> {
    await this.ready
    if (this.backend === 'memory') return

    if (this.backend === 'redis' && this.redis) {
      await this.redis.del(this.redisKey)
      if (this.messages.length) {
        await this.redis.rpush(this.redisKey, ...this.messages.map((m) => JSON.stringify(m)))
      }
      return
    }

    await fsp.mkdir(this.storagePath, { recursive: true })
    await fsp.writeFile(this.stateFile, JSON.stringify(this.messages, null, 2), 'utf-8')
    const last = this.messages[this.messages.length - 1]
    if (last && !last.read) {
      await fsp.appendFile(this.jsonlFile, JSON.stringify(last) + '\n', 'utf-8')
    }
  }

  async close(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit()
      } catch {
        /* ignore */
      }
    }
  }
}

export function createInbox(storagePathOrOpts?: string | InboxOptions): MessageInbox {
  return new MessageInbox(storagePathOrOpts)
}
