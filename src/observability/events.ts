import * as fs from 'fs/promises'
import * as path from 'path'
import { resolveProjectRoot } from '@/knowledge/paths'

export type EventLevel = 'info' | 'warn' | 'error' | 'debug'

export interface OrchestratorEvent {
  ts: number
  type: string
  level: EventLevel
  message?: string
  data?: Record<string, unknown>
}

/**
 * Append-only JSONL event log under <project>/.aio/events.jsonl
 * Disable with AIO_EVENTS=0
 */
export class EventLog {
  private enabled: boolean
  private filePath: string
  private buffer: OrchestratorEvent[] = []
  private maxBuffer: number

  constructor(projectRoot?: string, maxBuffer = 500) {
    this.enabled = process.env.AIO_EVENTS !== '0'
    const root = projectRoot || resolveProjectRoot()
    this.filePath = path.join(root, '.aio', 'events.jsonl')
    this.maxBuffer = maxBuffer
  }

  async emit(
    type: string,
    data?: Record<string, unknown>,
    level: EventLevel = 'info',
    message?: string
  ): Promise<void> {
    const event: OrchestratorEvent = {
      ts: Date.now(),
      type,
      level,
      message,
      data,
    }
    this.buffer.push(event)
    if (this.buffer.length > this.maxBuffer) {
      this.buffer = this.buffer.slice(-this.maxBuffer)
    }
    if (!this.enabled) return
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.appendFile(this.filePath, JSON.stringify(event) + '\n', 'utf-8')
    } catch {
      /* ignore disk errors */
    }
  }

  recent(limit = 50, typePrefix?: string): OrchestratorEvent[] {
    const filtered = typePrefix
      ? this.buffer.filter((e) => e.type.startsWith(typePrefix))
      : this.buffer
    return filtered.slice(-limit)
  }

  /** Merge in-memory buffer with `.aio/events.jsonl` (survives process restart). */
  async recentAsync(limit = 50, typePrefix?: string): Promise<OrchestratorEvent[]> {
    const fromDisk = await this.readTail(Math.max(limit * 3, 100))
    const byKey = new Map<string, OrchestratorEvent>()
    for (const e of [...fromDisk, ...this.buffer]) {
      byKey.set(eventKey(e), e)
    }
    let all = [...byKey.values()].sort((a, b) => a.ts - b.ts)
    if (typePrefix) {
      all = all.filter((e) => e.type.startsWith(typePrefix))
    }
    return all.slice(-limit)
  }

  private async readTail(maxLines: number): Promise<OrchestratorEvent[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const lines = raw.split('\n').filter((l) => l.trim())
      const slice = lines.slice(-maxLines)
      const out: OrchestratorEvent[] = []
      for (const line of slice) {
        try {
          const parsed = JSON.parse(line) as OrchestratorEvent
          if (typeof parsed.ts === 'number' && typeof parsed.type === 'string') {
            out.push(parsed)
          }
        } catch {
          /* skip corrupt line */
        }
      }
      return out
    } catch {
      return []
    }
  }

  get path(): string {
    return this.filePath
  }
}

function eventKey(e: OrchestratorEvent): string {
  return `${e.ts}|${e.type}|${e.message || ''}|${JSON.stringify(e.data || {})}`
}

const sharedByRoot = new Map<string, EventLog>()

export function getEventLog(projectRoot?: string): EventLog {
  const root = path.resolve(projectRoot || resolveProjectRoot())
  let log = sharedByRoot.get(root)
  if (!log) {
    log = new EventLog(root)
    sharedByRoot.set(root, log)
  }
  return log
}

export function resetEventLogForTests(): void {
  sharedByRoot.clear()
}
